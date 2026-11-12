/**
 * POST /api/upload：接收一份 JD 或简历原件，完成检查、提取、S3 上传与附件关联。
 * 浏览器的多文件上传会逐份调用本接口，单份失败不会导致整个批次中断。
 */
import { inferCandidateName } from "@/lib/domain";
import { requireApiAuth, apiError } from "@/lib/auth";
import { db } from "@/lib/db";
import { addCandidate } from "@/lib/projects";
import { validateFile, extractText } from "@/lib/files";
import { uploadFile, removeFiles } from "@/lib/storage";
/**
 * 文件缓冲区、DOCX/PDF 解析和 S3 SDK 在 Node.js 环境执行，不使用 Edge 运行时。
 */
export const runtime = "nodejs";
/**
 * FormData 包含 projectId、kind（jd/resume）和 file。
 * 先认证并确认项目存在，再处理文件；成功返回提取文本和可选 warning。
 * 解析失败仍保存原件，简历会进入异常材料列表，方便 HR 在同一条记录中补充正文。
 */
export async function POST(request: Request) {
	try {
		await requireApiAuth(request);
		const form = await request.formData();
		const projectId = String(form.get("projectId") || "");
		const kind = form.get("kind");
		const file = form.get("file");
		if (!(file instanceof File) || !["jd", "resume"].includes(String(kind)))
			throw new Error("请选择文件和材料类型");
		// 先执行格式和大小检查，再把文件读入缓冲区；业务不接受的文件不应进入对象存储。
		const ext = validateFile(file);
		await db.project.findUniqueOrThrow({ where: { id: projectId } });
		const buffer = Buffer.from(await file.arrayBuffer());
		let content = "";
		// 提取异常与上传失败分开处理：前者保留材料供修正，后者应向调用者报告失败。
		let parseError: string | undefined;
		try {
			content = await extractText(buffer, ext);
		} catch (e) {
			parseError = e instanceof Error ? e.message : "解析失败，请手动补充";
		}
		// 按已允许的扩展名确定保存的 MIME 类型，不直接信任浏览器上传时声明的 Content-Type。
		const mime = (
			{
				txt: "text/plain",
				md: "text/markdown",
				pdf: "application/pdf",
				docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			} as Record<string, string>
		)[ext];
		const key = await uploadFile(buffer, ext, mime);
		const attachment = {
			key,
			name: file.name.slice(0, 250),
			size: file.size,
			mime,
		};
		try {
			// 简历会创建候选人并关联原件；JD 只保存附件，提取文字返回编辑框，须由用户点击保存后生效。
			if (kind === "resume") {
				await addCandidate(
					projectId,
					inferCandidateName(content, file.name.replace(/\.[^.]+$/, "")),
					content,
					file.name,
					parseError,
					attachment,
				);
			} else {
				await db.attachment.create({
					data: { ...attachment, projectId, kind: "jd" },
				});
			}
		} catch (e) {
			// S3 对象已创建而数据库写入失败时，尽力删除孤立对象；清理失败不掩盖最初的写入错误。
			await removeFiles([key]).catch(() => {});
			throw e;
		}
		return Response.json({
			text: content,
			warning:
				parseError ||
				(!content ? "没有提取到文字，扫描 PDF 请手动粘贴文本" : undefined),
		});
	} catch (e) {
		return apiError(e);
	}
}
