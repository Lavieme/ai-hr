/**
 * 材料文件的服务端格式检查与文本提取。
 * 只处理文本、DOCX 和可提取文字的 PDF，不调用 OCR，也不把文档 HTML 渲染到页面。
 */
import "server-only";
import mammoth from "mammoth";
import { extname } from "node:path";
/**
 * 统一的 15 MB 单文件大小限制；客户端同样检查大小，但服务端检查才是写入前的依据。
 */
export const MAX_FILE_SIZE = 15 * 1024 * 1024;
/**
 * 按文件扩展名检查支持范围，并拒绝空文件或超过大小限制的文件。
 * 这里不做内容级格式鉴定，实际格式损坏会在解析阶段被捕获并标记给 HR 修正。
 */
export function validateFile(file: { name: string; size: number }) {
	const ext = extname(file.name).slice(1).toLowerCase();
	if (!["txt", "md", "docx", "pdf"].includes(ext))
		throw new Error("仅支持 TXT、Markdown、DOCX 和 PDF");
	if (!file.size || file.size > MAX_FILE_SIZE)
		throw new Error("单文件须为 1 字节至 15 MB");
	return ext;
}
/**
 * 把已通过格式检查的文件缓冲区提取为纯文本；抛错后由上传接口保留原件并记录异常。
 * PDF 先检查页数，再提取正文；统一移除空字符和首尾空白，并限制提取后的文字长度。
 */
export async function extractText(buffer: Buffer, ext: string) {
	let text = "";
	if (ext === "txt" || ext === "md") text = buffer.toString("utf8");
	else if (ext === "docx")
		text = (await mammoth.extractRawText({ buffer })).value;
	else {
		// PDF 解析器及其原生依赖按需加载，TXT、Markdown 和 DOCX 请求不需要初始化它们。
		const { PDFParse } = await import("pdf-parse");
		const parser = new PDFParse({ data: new Uint8Array(buffer) });
		try {
			const info = await parser.getInfo();
			if (info.total > 12) throw new Error("PDF 最多支持 12 页");
			const result = await parser.getText();
			// 扫描或空白 PDF 即使没有正文，解析库也可能插入页码页脚；移除它们才能正确识别空文本。
			text = result.text.replace(/--\s*\d+\s+of\s+\d+\s*--/g, "");
		} finally {
			// 无论提取成功、超过页数还是解析报错，都释放解析器持有的资源。
			await parser.destroy();
		}
	}
	text = text.replace(/\u0000/g, "").trim();
	if (text.length > 100000)
		throw new Error("文件文字过多（最多 10 万字），请拆分后上传");
	return text;
}
