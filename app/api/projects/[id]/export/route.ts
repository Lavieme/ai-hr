/**
 * GET /api/projects/:id/export：导出当前评价卡、人工推荐名单 CSV 或交付摘要 Markdown。
 * 导出从数据库读取已保存结果，不依赖浏览器草稿，候选人相关文本沿用当前项目的盲筛规则。
 */
import { requireApiAuth, apiError, HttpError } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { candidateNo, csvCell, mask } from "@/lib/domain";
/**
 * kind=csv 导出名单，kind=card 导出评价卡，其余情况导出交付摘要。
 * 名单只收录人工 interview 结论；需要重新检查的旧结论保留，但必须带出相应提醒。
 */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		await requireApiAuth();
		const p = await getProject((await params).id);
		if (!p) throw new HttpError(404, "项目不存在");
		const kind = new URL(request.url).searchParams.get("kind");
		// 不把 AI 证据数量或模型描述当成推荐依据，是否进入名单只取决于保存的人工决定。
		const list = p.candidates.filter((c) => c.decision === "interview");
		// 对自由文本依次替换本项目已知姓名，防止备注或追问中提及另一位候选人时遗漏脱敏。
		const sanitize = (value: string) =>
			p.candidates.reduce((s, c) => mask(s, c.name, p.blind), value);
		let body: string;
		let ext = "md";
		let mime = "text/markdown";
		if (kind === "csv") {
			// 优先使用人工填写的结论说明；未填写时回退到已人工确认的原文引用，不回退到未确认 AI 建议。
			const rows = [
				["编号", "候选人", "人工结论", "推荐依据", "待核实问题", "复核状态"],
				...list.map((c) => [
					candidateNo(c.number),
					p.blind ? candidateNo(c.number) : c.name,
					"建议进入面试",
					sanitize(
						c.reason ||
							c.judgments
								.filter((j) => j.status === "evidence")
								.map((j) => j.quote)
								.join("；"),
					),
					sanitize(
						c.judgments
							.map((j) => j.followup)
							.filter(Boolean)
							.join("；"),
					),
					c.needsReview ? "需要重新检查" : "已复核",
				]),
			];
			// CSV 使用 UTF-8 BOM 便于表格软件识别中文；单元格转义和公式防护集中在 csvCell。
			body =
				"\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
			ext = "csv";
			mime = "text/csv";
		} else if (kind === "card") {
			body = `# ${p.name} · 评价卡 V${p.version}\n\n${p.criteria.map((c) => `## ${c.title}\n优先级：${c.importance}\n\n证据：${c.evidence}`).join("\n\n")}\n\n经理确认：${p.confirmedAt ? p.confirmedBy : "未记录"}`;
		} else {
			body = `# ${p.name} · 交付摘要\n\n以下名单来自 HR 人工选择。\n\n${list
				.map(
					(c) =>
						`## ${p.blind ? candidateNo(c.number) : c.name}\n${c.needsReview ? "⚠ 评价卡或材料有变更，需要重新检查。\n" : ""}\n依据：${sanitize(
							c.reason ||
								c.judgments
									.filter((j) => j.status === "evidence")
									.map((j) => j.quote)
									.join("；"),
						)}\n\n待核实：${
							sanitize(
								c.judgments
									.map((j) => j.followup)
									.filter(Boolean)
									.join("；"),
							) || "无"
						}`,
				)
				.join("\n\n")}`;
		}
		// 以附件响应触发浏览器下载，并禁止缓存，避免后续访问复用过期的名单或盲筛设置。
		return new Response(body, {
			headers: {
				"Content-Type": `${mime}; charset=utf-8`,
				"Content-Disposition": `attachment; filename="ai-hr-${kind || "summary"}.${ext}"`,
				"Cache-Control": "no-store",
			},
		});
	} catch (e) {
		return apiError(e);
	}
}
