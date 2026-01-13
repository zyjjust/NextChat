import { GoogleGenAI, Type } from "@google/genai";
import {
  Resume,
  JobDescription,
  ResumeParsedInfo,
  JDParsedInfo,
  MatchResult,
  BatchJDInput,
} from "../../resume-match/types";
import { setGlobalDispatcher, ProxyAgent } from "undici";

// Proxy Configuration
if (process.env.HTTPS_PROXY) {
  try {
    const dispatcher = new ProxyAgent(process.env.HTTPS_PROXY);
    setGlobalDispatcher(dispatcher);
  } catch (e) {
    // Silent error for proxy setup
  }
}

/**
 * 获取随机的 AI 实例，支持负载均衡 (服务端版本)
 */
function getAI(): GoogleGenAI {
  // 优先使用服务端环境变量，如果没有则回退到 NEXT_PUBLIC_ (仅作兼容，实际上应该用服务端变量)
  const serverKey = process.env.GEMINI_API_KEY;
  const publicKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  const keysString = serverKey || publicKey || "";

  // Debug logging removed
  const keys = keysString
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key !== "");

  if (keys.length === 0) {
    console.error("[Server AI] No API keys found in environment variables");
    throw new Error("GEMINI_API_KEY is not configured in .env");
  }

  // 随机选择一个 API Key
  const randomIndex = Math.floor(Math.random() * keys.length);
  const selectedKey = keys[randomIndex];

  // 官方 SDK 可能不直接支持 baseUrl，或者参数格式不同。
  // 或者我们需要确认 @google/genai SDK 是否支持 baseUrl。
  // v1.35.0 SDK 实际上并不直接在构造函数支持 baseUrl。
  // 但是我们可以检查是否有其他方式配置。
  // 如果 SDK 不支持，我们可能需要回退到使用 fetch + REST API 的方式，或者寻找 SDK 的 requestOptions。
  // 查阅文档，GoogleGenAI SDK 的 getGenerativeModel 可以接受 RequestOptions?
  // 不，Client 构造函数好像不支持。
  // 此时最好是提示用户如果需要代理，需要在系统层面配置 Proxy，或者我们使用 fetch polyfill 注入代理。

  // 修正：官方 SDK 可能不直接方便地支持 baseUrl 替换 endpoint 全部路径。
  // 但很多第三方转发服务兼容 OpenAI 格式，而不是 Google 格式。
  // 如果是 Google 格式转发，通常改 base url 即可。

  // 官方 SDK 可能不直接支持 baseUrl，或者参数格式不同。
  // 为修复 lint 错误，暂时移除第二个参数。
  // 如果需要支持自定义 endpoint，可能需要查找正确的 SDK 用法或使用 fetch adapter。
  // 目前优先让用户尝试 HTTPS_PROXY。

  return new GoogleGenAI({ apiKey: selectedKey });
}

/**
 * 【OCR 增强】执行图片转文字
 */
export async function performOCR(base64Images: string[]): Promise<string> {
  if (base64Images.length === 0) return "";

  try {
    const ai = getAI();
    const parts = base64Images.map((base64) => ({
      inlineData: {
        mimeType: "image/jpeg",
        data: base64,
      },
    }));

    parts.push({
      text: "这是一份文档的扫描件图片。请务必完整、准确地提取图片中的所有文字内容。保持原始段落结构。如果包含表格，请尽量用文本还原表格结构。",
    } as any);

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: { parts: parts },
      config: {
        temperature: 0,
      },
    });

    return response.text || "";
  } catch (error) {
    console.error("OCR 识别失败:", error);
    return "";
  }
}

/**
 * 1. 候选人简历解析
 */
export async function parseResumeWithAI(
  content: string,
): Promise<ResumeParsedInfo> {
  const ai = getAI();
  const currentDate = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `你是一个专业的简历解析助手。请从以下简历纯文本中精准提取结构化信息。

    【当前日期参考】：${currentDate}
    请基于当前日期辅助判断候选人的最新状态（例如计算工作年限）。

    【核心指令 - 姓名提取 (Critical)】
    1. **中文优先**：必须优先提取简历中的**汉字姓名**（例如：原文有"戴诗君"，必须返回"戴诗君"）。
    2. **禁止拼音/英译**：严禁将中文名转换为拼音或英文（例如：看到"戴诗君"，**绝对不要**返回 "Dai Shijun" 或 "shijun_dai"）。
    3. **禁止臆测**：不要根据文件名或邮箱地址猜测姓名，必须基于简历正文提取。
    4. **排除法**：如果文中多次出现同一姓名，取最可能的候选人姓名。
    5. 只有在全文完全找不到汉字姓名的情况下，才返回拼音或英文名。

    【其他信息提取】
    - education: 提取学校名称和学位/学历。请包含毕业年份。
    - skills: 提取具体的硬技能和工具名称（字符串列表）。
    - experience: 简要概括最近的工作经历（公司+职位）。
    - summary: 基于简历内容生成一段50字以内的专业总结。
    
    简历内容: 
    ${content}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          education: { type: Type.STRING },
          skills: { type: Type.ARRAY, items: { type: Type.STRING } },
          experience: { type: Type.STRING },
          summary: { type: Type.STRING },
        },
        required: ["name", "education", "skills", "experience", "summary"],
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("AI 返回的简历解析结果为空");
  }
  return JSON.parse(text);
}

/**
 * 1. 岗位需求解析
 */
export async function parseJDWithAI(content: string): Promise<JDParsedInfo[]> {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `你是一个专业的HR助手。你的任务是从提供的原始文本中，【精准提取每一个】岗位需求。

    【核心定义与逻辑】：
    1. **原始JD (Original JD)**: 文档中的"岗位职责"、"岗位要求"、"任职资格"等内容，代表【客户原始提供的JD】。
    2. **重点澄清 (Key Clarification)**: 文档中的"重点澄清"、"特别说明"、"澄清事项"、"HSM澄清"、"Key Clarification"等内容，代表【HSM与客户沟通后的最终确认标准】。

    【提取要求】：
    1. **需求编号 (jobCode)**: 这一点非常重要。请仔细查找文本中的"需求编码"、"需求编号"、"需求ID"、"Job ID"、"Code"等字段。如果存在，请务必提取并填入 jobCode 字段。
    2. **重点澄清 (keyClarification)**: 这是一个**最高优先级**的字段。
       - 请务必识别出HSM/HR与业务方确认后的澄清内容。
       - 这通常包含比通用JD更具体、更准确的要求（例如：修正了原始JD中的学历要求，或指定了必须具备的某家公司背景）。
    3. **需求名称 (title)**: 必须使用文档中原始出现的名称。
    4. **完整性**: 识别文档中所有独立的岗位条目。

    请提取以下字段：
    - jobCode: 需求编号/ID（字符串，如果没有则留空字符串）。
    - title: 原始需求名称。
    - keyClarification: 重点澄清/特别说明内容（字符串，如果没有则留空字符串）。
    - description: 职位整体描述。
    - responsibilities: 客户原始岗位职责列表。
    - requirements: 客户原始任职要求（包含学历education、技能要求skills列表、经验experience、核心能力abilities列表）。

    输入内容：
    ${content}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            jobCode: { type: Type.STRING },
            title: { type: Type.STRING },
            keyClarification: { type: Type.STRING },
            description: { type: Type.STRING },
            responsibilities: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            requirements: {
              type: Type.OBJECT,
              properties: {
                education: { type: Type.STRING },
                skills: { type: Type.ARRAY, items: { type: Type.STRING } },
                experience: { type: Type.STRING },
                abilities: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["education", "skills", "experience", "abilities"],
            },
          },
          required: [
            "jobCode",
            "title",
            "keyClarification",
            "description",
            "responsibilities",
            "requirements",
          ],
        },
      },
    },
  });

  try {
    const text = response.text?.trim();
    if (!text) {
      return [];
    }
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("JD解析失败:", e);
    return [];
  }
}

/**
 * 批量解析岗位需求
 */
export async function parseJDBatchWithAI(
  inputs: BatchJDInput[],
): Promise<(JDParsedInfo & { rowIndex: number })[]> {
  if (inputs.length === 0) return [];

  const ai = getAI();

  // 构造批量输入的 JSON 格式
  const batchInput = inputs.map((item, idx) => ({
    rowIndex: item.rowIndex,
    jobCode: item.jobCode,
    title: item.title,
    rawContent: item.rawContent,
    keyClarification: item.keyClarification,
  }));

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `你是一个专业的HR助手。你需要批量解析以下多个岗位需求。

【输入格式说明】：
我会给你一个 JSON 数组，每个元素代表一个岗位需求。每个元素包含：
- rowIndex: 行号（用于结果匹配，必须原样返回）
- jobCode: 需求编号（如果为空，请从 rawContent 中尝试提取）
- title: 岗位名称（如果为空，请从 rawContent 中提取）
- rawContent: 原始 JD 信息
- keyClarification: 重点澄清内容

【输出要求】：
返回一个 JSON 数组，每个元素对应一个岗位，包含：
- rowIndex: 原样返回输入的行号
- jobCode: 需求编号
- title: 岗位名称
- keyClarification: 重点澄清（优先使用输入的值，如果输入为空则从 rawContent 提取）
- description: 职位整体描述
- responsibilities: 岗位职责数组
- requirements: 任职要求对象 { education, skills[], experience, abilities[] }

【待解析的岗位列表】：
${JSON.stringify(batchInput, null, 2)}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            rowIndex: { type: Type.NUMBER },
            jobCode: { type: Type.STRING },
            title: { type: Type.STRING },
            keyClarification: { type: Type.STRING },
            description: { type: Type.STRING },
            responsibilities: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            requirements: {
              type: Type.OBJECT,
              properties: {
                education: { type: Type.STRING },
                skills: { type: Type.ARRAY, items: { type: Type.STRING } },
                experience: { type: Type.STRING },
                abilities: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ["education", "skills", "experience", "abilities"],
            },
          },
          required: [
            "rowIndex",
            "jobCode",
            "title",
            "keyClarification",
            "description",
            "responsibilities",
            "requirements",
          ],
        },
      },
    },
  });

  try {
    const text = response.text?.trim();
    if (!text) {
      console.error("批量 JD 解析返回为空");
      return [];
    }
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("批量 JD 解析失败:", e);
    return [];
  }
}

/**
 * 2. 简历与岗位匹配分析
 */
export async function matchResumeToJDs(
  resume: Resume,
  jds: JobDescription[],
  matchModel:
    | "gemini-3-flash-preview"
    | "gemini-3-pro-preview" = "gemini-3-pro-preview",
): Promise<{
  result: MatchResult;
  usage: { promptTokens: number; outputTokens: number };
}> {
  const ai = getAI();
  const currentDate = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const jdDescriptions = jds
    .map(
      (jd) => `
    【岗位ID: ${jd.id}】
    需求名称: ${jd.title}
    >>> 重点澄清 (HSM与客户确认的最终标准 - 最高优先级) <<<: ${
      jd.parsedData?.keyClarification || "无"
    }
    [客户原始] 岗位职责: ${jd.parsedData?.responsibilities.join("; ")}
    [客户原始] 任职要求: ${JSON.stringify(jd.parsedData?.requirements)}
  `,
    )
    .join("\n\n====================\n\n");

  const prompt = `
    你是一个极其严格的【技术面试官】。请将候选人简历与选定的 ${jds.length} 个岗位需求进行全方位的智能匹配。

    【当前真实日期】：${currentDate}

    【候选人简历】：
    ${resume.rawContent}

    【待匹配岗位列表】：
    ${jdDescriptions}

    【匹配规则 - 极其重要】：
    0. **时间与状态判定 (Time Context)**:
       - **毕业判定**: 请基于【当前真实日期】计算候选人的毕业状态。如果 (毕业时间 <= 当前日期) 或 (毕业时间 > 当前日期 但 < 6个月)，可视为"已毕业/应届生"，不应视为"在读学生"而拒绝。
       - **特殊学制**: 对于"自考"、"成人本科"、"函授"等非全日制学历，如果候选人简历中同时包含全职工作经历，**绝对不应**将其视为"在读学生"或"实习生"，他们属于社招人员。
       - 案例: 简历写"2025年6月自考本科毕业"，当前若为2026年1月，则该候选人已毕业。即使当前是2025年2月，且他有多年工作经验，也不应视为在读学生，而应视为在职进修人员。

    1. **重点澄清优先原则 (HSM Clarification Override)**:
       - **定义**: "岗位职责"和"任职要求"是【客户原始JD】；"重点澄清"是【根据模版提取的最终修正标准】。
       - **绝对优先**: 重点澄清内容的优先级 **高于** 原始JD。如果模版中的第 5 列（重点澄清）有专门的描述，即使与前面的列有冲突，也必须以重点澄清为准。
       - **冲突处理**: 如果原始JD要求"统招本科"，但重点澄清写"学信网可查即可"，则以重点澄清为准（放宽）。如果原始JD写"熟悉Java"，但重点澄清写"必须精通Java并发编程"，则以重点澄清为准（收紧）。
       - **隐性门槛**: 重点澄清中往往包含原始JD未写明的"硬性红线"（如：必须有金融行业背景、跳槽不能太频繁等），必须严格执行。

    2. **学历一票否决制 (Mandatory Education Veto)**:
       - **逻辑**: 学历等级顺序为 博士 (PhD) > 硕士 (Master) > 本科 (Bachelor) > 大专 (College/Associate) > 高中/中专。
       - **判定**: 必须首先对比 [候选人最高学历] 与 [岗位要求的最低学历]。
       - **处罚**: 如果候选人学历 **低于** 岗位要求（例如：岗位要求"本科"，候选人是"大专"），则该岗位的 **score 必须严格设置为 0**。
       - **反馈**: 这种情况下，comprehensiveEvaluation 必须以 "【学历不符】" 开头。
       - **注意**: 如果"重点澄清"中对学历有更严格的要求（如"必须985/211"或"必须硕士"），则以重点澄清为准执行一票否决。

    3. **教育信息缺失一票否决 (Missing Education Veto)**:
       - **判定**: 如果简历中**完全没有**教育经历、学历信息、毕业院校等任何教育相关内容，则视为"教育信息缺失"。
       - **处罚**: 教育信息缺失的简历，所有岗位的 **score 必须严格设置为 30 分以下**（建议 10-25 分之间，根据其他维度酌情调整）。
       - **反馈**: 这种情况下，comprehensiveEvaluation 必须以 "【教育信息缺失】" 开头，并说明由于无法核实学历背景，存在较大用人风险。
       - **注意**: 即使候选人技能和经验非常优秀，缺少教育信息仍然是硬性扣分项，不可给予高分。

    4. **职业大类冲突校验 (Category Match)**:
       - **判定**: 必须首先判定候选人的核心职业大类（如：销售、行政、人力资源）与岗位的目标领域（如：纯技术开发、视觉设计、算法研究）是否存在根本性冲突。
       - **原则**: 禁止因为"沟通能力强"、"有责任心"、"学习能力快"等通用软技能，而将非技术人员强行匹配给硬技术岗位。
       - **处理**: 如果存在根本性类目冲突且候选人无相关转型背景，该岗位的 **score 必须低于 10 分**（建议 0 分），且综合评估需注明"职能类别与岗位需求不匹配"。

    5. **灵活匹配原则 (Flexible Matching)**:
       - **取消强制性**: **严禁**为了凑数而强行将候选人匹配给不相关的岗位。如果没有合适的岗位，允许返回空列表或全低分结果。
       - **数量**: 按匹配度从高到低排序，返回最匹配的岗位，数量**最多** 3 个（可以为 0, 1 或 2 个）。

    6. **其他规则**:
       - ID 匹配: 返回 JSON 中的 jdId 必须严格等于提供的岗位ID。
       - 维度评分: 如果学历和职能类目均达标，则根据技能、经验、能力进行综合评分 (0-100)。
    
    【核心指令 - 综合评估 (comprehensiveEvaluation)】:
    - **角色定位**: 你是一个拥有多年经验的"资深猎头/专业初筛官"。这段评语是给甲方客户看的"面试推荐意见"，目标是促成面试。
    - **禁止痕迹**: **绝对严禁**提及"简历中未提及"、"对比发现"等任何暴露你在进行"文件比对"而非"专家研判"的痕迹。
    - **禁止阻断话术**: **严禁**直接指出"由于缺少xx经验，存在提升空间"、"在xx领域尚显不足"等可能导致甲方立即否决简历的负面、阻断性评价。
    - **正面引导**: 你的结论应聚焦于"候选人已具备的价值"以及"与岗位的匹配逻辑"。即使某项技能在简历中缺失，也应通过正面描述来平替，例如：将"缺少垂直行业经验"平替为"拥有跨行业的通用架构能力，技术底层迁移成本低"；将"技能深度不足"平替为"在核心环节具备坚实的落地经验"。
    - **风格**: **专业、客观、正面、有含金量**。用词要显出专家范儿，让甲方觉得这是一位有潜力的候选人。
    - **格式**: **严禁**以"该候选人"、"此人"、"Candidate"等主语开头。直接陈述事实和判断。
    - **字数**: 60-120 字。
    - **正例**: "深耕前端开发领域，对React生态及高并发性能优化有深入的实践积淀。在分布式系统架构方面展现出稳健的技术底座，其跨行业的复杂业务处理经验有助于快速适应电商业务场景。整体技术栈与岗位需求契合度高，是一位极具专业深度且扩展性强的行业人才。"
    - **反例**: "虽然他在前端很有经验，但在电商法律法规上还存在提升空间..." (错误：这种负面描述会让候选人被直接刷掉)
    - **反例**: "他是极佳人选..." (错误：评价过于廉价，不够客观)

    请严格按以下 JSON 格式返回结果。
  `;

  try {
    const response = await ai.models.generateContent({
      model: matchModel,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            resumeId: { type: Type.STRING },
            resumeName: { type: Type.STRING },
            matches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  jdId: { type: Type.STRING },
                  jdTitle: { type: Type.STRING },
                  score: { type: Type.NUMBER },
                  comprehensiveEvaluation: { type: Type.STRING },
                  strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                  weaknesses: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  improvementSuggestions: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  isBestMatch: { type: Type.BOOLEAN },
                },
                required: [
                  "jdId",
                  "jdTitle",
                  "score",
                  "comprehensiveEvaluation",
                  "strengths",
                  "weaknesses",
                  "improvementSuggestions",
                  "isBestMatch",
                ],
              },
            },
          },
          required: ["resumeId", "resumeName", "matches"],
        },
      },
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("AI 返回的匹配结果为空");
    }
    const result = JSON.parse(responseText);

    // 补全 ID 映射确保前端能正确对应
    result.resumeId = resume.id;
    result.resumeName = resume.parsedData?.name || "未知候选人";
    result.matches.sort((a: any, b: any) => b.score - a.score);

    // 获取 Token 使用量
    const usage = {
      promptTokens: response.usageMetadata?.promptTokenCount || 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
    };

    return { result, usage };
  } catch (error) {
    console.error("匹配 API 调用失败:", error);
    throw error;
  }
}
