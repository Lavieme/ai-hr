/**
 * GET /api/attachments/:id：先检查会话和盲筛状态，再跳转到即时签名的私有原件下载地址。
 */
import { requireApiAuth, apiError, HttpError } from "@/lib/auth";
import { db } from "@/lib/db";
import { downloadUrl } from "@/lib/storage";
/**
 * 对外使用附件记录 id，不直接信任客户端提交的任意 S3 key。
 * 简历原件可能包含未脱敏的身份信息，所以即使直接访问下载接口，也必须先关闭项目盲筛。
 */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		await requireApiAuth();
		const file = await db.attachment.findUnique({
			where: { id: (await params).id },
			include: { project: true },
		});
		if (!file) throw new HttpError(404, "文件不存在");
		if (file.kind === "resume" && file.project.blind)
			throw new HttpError(403, "请先关闭盲筛，再下载原始简历");
		// 浏览器直接从对象存储获取文件，应用无需把大文件再次读入内存转发；签名地址不写回数据库。
		return Response.redirect(await downloadUrl(file.key));
	} catch (e) {
		return apiError(e);
	}
}
