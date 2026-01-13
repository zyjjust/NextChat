import { performOCR } from "./geminiService";

declare const mammoth: any;
declare const XLSX: any;
declare const pdfjsLib: any;

export async function parseFile(file: File): Promise<string> {
    const extension = file.name.split(".").pop()?.toLowerCase();

    switch (extension) {
        case "txt":
            // 尝试使用 TextDecoder 处理可能的 GBK 编码（中国地区常见乱码原因）
            const buffer = await file.arrayBuffer();
            const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
            try {
                return utf8Decoder.decode(buffer);
            } catch (e) {
                // 如果 UTF-8 解码失败，尝试使用 GBK
                const gbkDecoder = new TextDecoder("gbk");
                return gbkDecoder.decode(buffer);
            }

        case "docx":
            const docxArrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({
                arrayBuffer: docxArrayBuffer,
            });
            return result.value;

        case "doc":
            try {
                // 尝试使用 mammoth (有些 .doc 实际上是伪装好的 .docx)
                const docArrayBuffer = await file.arrayBuffer();
                const docResult = await mammoth.extractRawText({
                    arrayBuffer: docArrayBuffer,
                });
                return docResult.value;
            } catch (e) {
                throw new Error(
                    `无法直接解析旧版二进制 .doc 文件。请将其另存为 .docx 或 PDF 后再次尝试。`,
                );
            }

        case "xlsx":
        case "xls":
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            let fullContent = "";
            workbook.SheetNames.forEach((sheetName: string) => {
                const worksheet = workbook.Sheets[sheetName];
                // 使用 CSV 格式导出，CSV 对 AI 来说结构感更强，且编码处理更稳定
                fullContent += `--- Sheet: ${sheetName} ---\n`;
                fullContent += XLSX.utils.sheet_to_csv(worksheet);
                fullContent += "\n\n";
            });
            return fullContent;

        case "pdf":
            const pdfBuffer = await file.arrayBuffer();
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
            const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
            let textContent = "";
            let isImageBased = true; // 假设是图片，直到发现足够长的文本
            const totalPages = pdf.numPages;
            const MAX_OCR_PAGES = 5; // 限制 OCR 页数以避免浏览器崩溃或Token超限

            // 1. 尝试直接提取文本
            for (let i = 1; i <= totalPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                const pageText = content.items.map((item: any) => item.str).join(" ");

                // 简单判断：如果某一页提取出的文本超过 50 个字符，我们认为它不是纯图片 PDF
                if (pageText.trim().length > 50) {
                    isImageBased = false;
                }
                textContent += pageText + "\n";
            }

            // 2. 如果文本内容极少，启动 OCR 流程
            if (isImageBased || textContent.trim().length < 50) {
                console.log("检测到图片型 PDF，启动 OCR 流程...");
                const images: string[] = [];

                for (let i = 1; i <= Math.min(totalPages, MAX_OCR_PAGES); i++) {
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({ scale: 1.5 }); // 1.5倍缩放以保证清晰度
                    const canvas = document.createElement("canvas");
                    const context = canvas.getContext("2d");

                    if (context) {
                        canvas.height = viewport.height;
                        canvas.width = viewport.width;

                        await page.render({
                            canvasContext: context,
                            viewport: viewport,
                        }).promise;

                        // 转换为 base64 jpeg
                        const base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
                        images.push(base64);
                    }
                }

                // 调用 Gemini 进行 OCR
                const ocrText = await performOCR(images);
                if (ocrText.trim()) {
                    return `[OCR 识别结果]:\n${ocrText}`;
                }
            }

            return textContent;

        default:
            throw new Error(`不支持的文件类型: ${extension}`);
    }
}

export function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const base64 = (reader.result as string).split(",")[1];
            resolve(base64);
        };
        reader.onerror = (error) => reject(error);
    });
}
