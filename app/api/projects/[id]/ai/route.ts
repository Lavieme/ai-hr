/**
 * POST /api/projects/:id/ai：按 kind 区分评价卡起草与候选人证据提取。
 * 外部模型调用放在数据库事务之外，避免长时间持有数据库连接和项目锁。
 */
import { requireApiAuth, apiError } from "@/lib/auth";
import { db } from "@/lib/db";
import { draftCriteria, extractEvidence } from "@/lib/ai";
import { getProject } from "@/lib/projects";
import { z } from "zod";
export const runtime = "nodejs";
/**
 * 请求体包含 kind，以及证据模式需要的 candidateId；评价卡模式可提供待起草的 JD。
 * 评价卡只返回草稿，证据模式在生成后核对版本并保存到候选人，始终不写人工结论。
 */
export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		await requireApiAuth(request);
		// 接口自身仍需验证请求形状；调用方不一定来自当前页面按钮。
		const input = z
			.object({
				kind: z.enum(["criteria", "evidence"]),
				candidateId: z.string().optional(),
				jd: z.string().max(100000).optional(),
			})
			.parse(await request.json());
		const p = await getProject((await params).id);
		if (!p) throw new Error("项目不存在");
		// 只生成草稿，不在这里修订评价卡；用户核对后通过普通保存动作创建正式新版本。
		if (input.kind === "criteria") {
			const jd = input.jd ?? p.jd;
			if (!jd.trim()) throw new Error("请先填写 JD");
			return Response.json({ criteria: await draftCriteria(jd) });
		}
		// 必须属于当前项目且材料已确认可用，不能借当前项目接口请求其他候选人的 AI 分析。
		const c = p.candidates.find((c) => c.id === input.candidateId);
		if (!c || c.importStatus !== "ready")
			throw new Error("请先选择材料可用的候选人");
		// 生成函数已验证输出结构及逐字原文引用；接下来处理请求等待期间发生的数据变化。
		const result = await extractEvidence(c.content, p.criteria);
		await db.$transaction(async (tx) => {
			// 短事务内锁住项目，并重读最新标准版本及材料正文；若上下文变化则拒绝保存旧结果。
			await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${p.id} FOR UPDATE`;
			const latest = await tx.project.findUniqueOrThrow({
				where: { id: p.id },
			});
			const candidate = await tx.candidate.findUniqueOrThrow({
				where: { id: c.id },
			});
			if (latest.version !== p.version || candidate.content !== c.content)
				throw new Error("材料或评价卡已更新，请重新提取");
			await tx.candidate.update({
				where: { id: c.id },
				// 只写 AI 结果和它所依据的标准版本，不更新 decision、judgments 或 needsReview。
				data: { aiResult: result, aiVersion: p.version },
			});
		});
		return Response.json({ result });
	} catch (e) {
		return apiError(e);
	}
}
