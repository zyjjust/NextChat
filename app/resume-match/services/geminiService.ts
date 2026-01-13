import {
  Resume,
  JobDescription,
  ResumeParsedInfo,
  JDParsedInfo,
  MatchResult,
  BatchJDInput,
} from "../types";

/**
 * 通用 API 请求函数
 */
async function postAPI<T>(endpoint: string, data: any): Promise<T> {
  try {
    const response = await fetch(`/api/resume-match/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `API Request failed with status ${response.status}`,
      );
    }

    return await response.json();
  } catch (error) {
    console.error(`API Call to ${endpoint} failed:`, error);
    throw error;
  }
}

/**
 * 【OCR 增强】执行图片转文字
 * 当 PDF 解析为纯图片时调用此方法
 */
export async function performOCR(base64Images: string[]): Promise<string> {
  if (base64Images.length === 0) return "";
  try {
    const result = await postAPI<{ text: string }>("ocr", { base64Images });
    return result.text;
  } catch (error) {
    console.error("OCR 识别失败:", error);
    return ""; // 如果 OCR 失败，返回空字符串，避免阻断流程
  }
}

/**
 * 1. 候选人简历解析
 * 任务类型：基础文本提取 (Basic Text Tasks)
 */
export async function parseResumeWithAI(
  content: string,
): Promise<ResumeParsedInfo> {
  return postAPI<ResumeParsedInfo>("parse-resume", { content });
}

/**
 * 1. 岗位需求解析
 * 任务类型：基础文本提取 (Basic Text Tasks)
 */
export async function parseJDWithAI(content: string): Promise<JDParsedInfo[]> {
  return postAPI<JDParsedInfo[]>("parse-jd", { content });
}

/**
 * 批量解析岗位需求（Excel 导入专用）
 * 将多个岗位信息合并成一次 API 调用，大幅减少请求次数
 */
export async function parseJDBatchWithAI(
  inputs: BatchJDInput[],
): Promise<(JDParsedInfo & { rowIndex: number })[]> {
  if (inputs.length === 0) return [];
  return postAPI<(JDParsedInfo & { rowIndex: number })[]>("parse-jd-batch", {
    inputs,
  });
}

/**
 * 2. 简历与岗位匹配分析
 * 任务类型：复杂推理与分析 (Complex Text Tasks)
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
  return postAPI<{
    result: MatchResult;
    usage: { promptTokens: number; outputTokens: number };
  }>("match", { resume, jds, matchModel });
}
