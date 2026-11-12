/**
 * 客户端和服务端共用的业务规则与输入类型。
 * 本模块不访问数据库、Cookie 或外部服务，因此可安全用于 React 表单和服务端校验。
 * 客户端校验主要改善交互体验，真正写入前仍须在 Server Action 中再次校验。
 */
import { z } from "zod";
/**
 * 单项评价标准。已有记录携带 id，新建条目可省略 id，保存时由数据库生成。
 * importance 的含义：must 为必须满足，core 为重点考察，bonus 为加分项。
 */
export const criterionSchema = z.object({
	id: z.string().optional(),
	title: z.string().trim().min(1).max(500),
	evidence: z.string().trim().max(2000).default("具体描述个人行动、过程或结果"),
	importance: z.enum(["must", "core", "bonus"]).default("core"),
});
// 整个评价卡至少包含一项标准，最多 30 项；规则草稿和 AI 草稿也复用这套结构。
export const criteriaSchema = z.array(criterionSchema).min(1).max(30);
export type CriterionInput = z.infer<typeof criterionSchema>;
/**
 * HR 对某一项标准的人工判断，与模型生成的线索分开保存。
 * evidence 表示已核对证据，insufficient 表示证据不足，unclear 表示尚未确认。
 * quote 必须是简历原文；note 记录人工备注，followup 记录待核实问题。
 */
export const judgmentSchema = z.object({
	criterionId: z.string(),
	status: z.enum(["evidence", "insufficient", "unclear"]),
	quote: z.string().max(10000).default(""),
	note: z.string().max(2000).default(""),
	followup: z.string().max(2000).default(""),
});
/**
 * 一次复核的完整输入。version 表示 HR 操作时看到的评价卡版本，服务端用它拒绝过期提交。
 * decision 分为 interview（进入面试）、more（待补充信息）、hold（暂不推进）。
 */
export const reviewSchema = z.object({
	candidateId: z.string(),
	version: z.number().int(),
	decision: z.enum(["interview", "more", "hold"]),
	reason: z.string().trim().max(5000),
	judgments: z.array(judgmentSchema).max(30),
});
/**
 * 根据提取结果生成材料检查状态，按空文本、重复、文本过短的顺序判断。
 * ready 仅表示可以进入人工复核，不表示候选人满足岗位要求。
 */
export function importState(content: string, duplicate: boolean) {
	if (!content.trim())
		return {
			importStatus: "failed",
			importNote: "没有可用文本，请手动补充。扫描 PDF 请粘贴识别后的文字。",
		};
	if (duplicate)
		return {
			importStatus: "duplicate",
			importNote: "发现内容相同的简历，请修正或确认继续复核。",
		};
	if (content.trim().length < 90)
		return {
			importStatus: "incomplete",
			importNote: "文本较短，请核对后确认材料可用。",
		};
	return { importStatus: "ready", importNote: "" };
}
/**
 * 不依赖 AI 的评价卡初稿：逐行读取 JD，用章节标题决定后续条目的优先级。
 * 标题匹配附带长度限制，避免把含有“职责”等词的长句误认为章节。
 * 最多生成 14 项；没有有效内容时保留一项通用标准供 HR 编辑。
 */
export function ruleCriteria(jd: string): CriterionInput[] {
	let section: "must" | "core" | "bonus" = "must";
	const result: CriterionInput[] = [];
	for (const raw of jd.split("\n")) {
		const s = raw.trim();
		if (!s || /岗位名称/.test(s)) continue;
		if (s.length < 35 && /职责|工作内容/.test(s)) {
			section = "core";
			continue;
		}
		if (s.length < 35 && /任职要求|任职资格|岗位要求/.test(s)) {
			section = "must";
			continue;
		}
		if (s.length < 35 && /加分项|优先条件/.test(s)) {
			section = "bonus";
			continue;
		}
		const title = s.replace(/^[-•●\d.、）)\s]+/, "").slice(0, 500);
		if (title.length > 2)
			result.push({
				title,
				evidence: "具体描述个人行动、过程或结果；课程、社团和实习经历均可",
				importance: section,
			});
	}
	return result.slice(0, 14).length
		? result.slice(0, 14)
		: [
				{
					title: "与岗位相关的实践经历",
					evidence: "具体描述个人行动、过程或结果",
					importance: "core",
				},
			];
}
/**
 * 从明确的“姓名/Name”标签或简历首行尝试识别姓名，最后回退到调用方提供的名称。
 * 避免把“个人简历”等标题当姓名；识别结果也用于盲筛时替换原文中的已知姓名。
 * 这里只做有限的格式识别，HR 仍可在关闭盲筛后修正候选人姓名。
 */
export function inferCandidateName(content: string, fallback: string) {
	const labeled = content.match(
		/(?:姓名|name)\s*[:：]\s*([\p{Script=Han}·]{2,6}|[A-Za-z][A-Za-z .'-]{1,50})/iu,
	)?.[1];
	const first = content.trim().split("\n")[0]?.split(/[|｜]/)[0].trim();
	const plausible =
		first &&
		(/^[\p{Script=Han}·]{2,4}$/u.test(first) ||
			/^[A-Za-z]+(?: [A-Za-z]+){1,3}$/.test(first)) &&
		!/个人简历|求职简历|教育背景/.test(first);
	return (
		(labeled || (plausible ? first : fallback)).trim().slice(0, 200) || "候选人"
	);
}
/**
 * 按项目盲筛开关对展示文本脱敏，不修改数据库中的简历原文。
 * 替换已知姓名、邮箱、中国大陆手机号及常见中文院校名称。
 * 这是复核展示规则，不是权限边界，也不保证识别所有格式的个人信息。
 */
export function mask(text: string, name: string, blind: boolean) {
	if (!blind) return text;
	let t = text;
	if (name.length > 1) t = t.split(name).join("［姓名已隐藏］");
	return t
		.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "［邮箱已隐藏］")
		.replace(/(?:\+?86[- ]?)?1[3-9]\d{9}/g, "［电话已隐藏］")
		.replace(/[\u4e00-\u9fa5]{2,12}(?:大学|学院)/g, "［院校已隐藏］");
}
/**
 * 将项目内固定编号格式化为 C-001 等展示编号；补零只影响显示，不改变记录主键。
 */
export function candidateNo(number: number) {
	return `C-${String(number).padStart(3, "0")}`;
}
/**
 * 对“建议进入面试”设置最小依据要求：至少一项已确认的非空原文证据，或至少 5 字的具体说明。
 * 这里不计算分数、不自动推导结论；原文真实性由调用方先逐项校验。
 */
export function assertRecommendation(
	decision: string,
	reason: string,
	judgments: { status: string; quote: string }[],
) {
	if (
		decision === "interview" &&
		reason.trim().length < 5 &&
		!judgments.some((j) => j.status === "evidence" && j.quote.trim())
	) {
		throw new Error(
			"推荐进入面试前，请确认至少一项原文证据，或填写具体推荐依据（至少 5 字）。",
		);
	}
}
/**
 * 生成双引号包裹的 CSV 单元格，内部双引号按 CSV 规则转义。
 * 对公式起始字符补单引号，避免简历或备注文本被表格软件当作公式执行。
 */
export function csvCell(value: string) {
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return `"${safe.replace(/"/g, '""')}"`;
}
// 数据库状态值与中文展示文案的统一映射，复核页面和列表共用。
export const decisionLabels: Record<string, string> = {
	interview: "建议进入面试",
	more: "待补充信息",
	hold: "暂不推进",
};
