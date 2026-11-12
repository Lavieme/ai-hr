/**
 * 项目与材料的服务端数据操作。
 * 评价卡版本、候选人编号及失效标记需要多表一致性，因此在这里集中维护事务。
 */
import { hashText } from "./hash";
import "server-only";
import { db } from "./db";
import { Prisma } from "./generated/prisma/client";
import {
	criteriaSchema,
	importState,
	ruleCriteria,
	type CriterionInput,
} from "./domain";
/**
 * 完整工作台的数据查询形状：标准按手动顺序、候选人按固定编号、反馈与版本按时间倒序。
 * 页面与相关 API 共用这个定义，避免展示排序和读取字段各自漂移。
 */
export const projectInclude = {
	criteria: { orderBy: { position: "asc" as const } },
	candidates: {
		orderBy: { number: "asc" as const },
		include: { judgments: true, attachments: true },
	},
	feedback: { orderBy: { createdAt: "desc" as const } },
	versions: { orderBy: { version: "desc" as const } },
	attachments: true,
};
/**
 * 从 Prisma 查询定义推导完整项目类型，增加关联字段时不需要手动维护另一份服务端接口。
 */
export type FullProject = Prisma.ProjectGetPayload<{
	include: typeof projectInclude;
}>;
/**
 * 读取完整项目；不存在时返回 null，由页面或 API 决定如何提示。
 */
export async function getProject(id: string) {
	return db.project.findUnique({ where: { id }, include: projectInclude });
}
/**
 * 新建岗位时先用规则生成 V1 标准，并通过嵌套写入同时创建项目、标准和版本快照。
 * 可选 id 支持需要固定标识的调用场景，普通新项目由 Prisma 自动生成主键。
 */
export async function createProject(name: string, jd: string, id?: string) {
	const criteria = ruleCriteria(jd);
	return db.project.create({
		data: {
			...(id ? { id } : {}),
			name,
			jd,
			criteria: { create: criteria.map((c, position) => ({ ...c, position })) },
			versions: { create: { version: 1, snapshot: criteria } },
		},
	});
}
/**
 * 保存评价卡修订，或应用模板；两条入口复用同一套版本与失效规则。
 * @param expectedVersion 客户端编辑时的版本，用于避免覆盖另一位操作者已保存的修订。
 * 已有标准保留 id，新增标准生成 id，被移除标准及其关联判断按模型关系删除。
 */
export async function replaceCriteria(
	projectId: string,
	input: CriterionInput[],
	expectedVersion: number,
) {
	const criteria = criteriaSchema.parse(input);
	return db.$transaction(async (tx) => {
		// 锁住当前项目行，与编号分配和人工复核使用相同的锁，协调并发的项目级操作。
		await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
		const project = await tx.project.findUniqueOrThrow({
			where: { id: projectId },
			include: { criteria: true },
		});
		if (project.version !== expectedVersion)
			throw new Error("评价卡已更新，请刷新后重试");
		// 客户端携带的已有标准 id 必须全部属于本项目且不能重复；未携带 id 的条目按新增处理。
		const existing = new Set(project.criteria.map((c) => c.id));
		const supplied = criteria.filter((c) => c.id).map((c) => c.id!);
		if (
			new Set(supplied).size !== supplied.length ||
			supplied.some((id) => !existing.has(id))
		)
			throw new Error("评价标准不属于当前项目");
		// 只删除本次提交未保留的条目；保留的条目随后逐项更新，position 记录表单中的顺序。
		await tx.criterion.deleteMany({
			where: { projectId, id: { notIn: supplied } },
		});
		for (const [position, c] of criteria.entries()) {
			const { id, ...data } = c;
			if (id)
				await tx.criterion.update({
					where: { id },
					data: { ...data, position },
				});
			else
				await tx.criterion.create({ data: { ...data, projectId, position } });
		}
		// 快照保留当前提交的标准内容，版本号在同一事务内递增。
		const version = project.version + 1;
		await tx.cardVersion.create({
			data: { projectId, version, snapshot: criteria },
		});
		// 标准变化后，原 AI 线索不再对应当前评价卡；DbNull 表示清除 SQL 字段，而非保存 JSON null。
		await tx.candidate.updateMany({
			where: { projectId },
			data: { aiResult: Prisma.DbNull, aiVersion: null },
		});
		await tx.candidate.updateMany({
			// 保留旧人工结论供对照，只标记需要重新检查；从未复核的候选人无需额外标记。
			where: { projectId, decision: { not: null } },
			data: { needsReview: true },
		});
		await tx.project.update({
			where: { id: projectId },
			// 经理确认绑定的是某一版标准；标准改动后清空旧确认，避免误认为新版本已获确认。
			data: { version, confirmedAt: null, confirmedBy: "" },
		});
	});
}
/**
 * 向项目导入一份候选人材料，并可关联已经上传到 S3 的原件信息。
 * 项目内编号、重复检测和附件记录在同一事务内处理；S3 上传由接口在事务之外先完成。
 * parseError 会覆盖自动检查状态，确保解析异常不能直接进入复核队列。
 */
export async function addCandidate(
	projectId: string,
	name: string,
	content: string,
	source: string,
	parseError?: string,
	attachment?: { name: string; key: string; size: number; mime: string },
) {
	return db.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
		await tx.project.findUniqueOrThrow({ where: { id: projectId } });
		const contentHash = hashText(content);
		// 只把非空正文参与重复检测，避免多份解析失败文件因空文本指纹相同而被误判为重复。
		const duplicate =
			!!content.trim() &&
			!!(await tx.candidate.findFirst({ where: { projectId, contentHash } }));
		// 在项目行锁保护下分配下一个编号，防止并发上传得到相同编号；不使用当前数组下标编号。
		const last = await tx.candidate.aggregate({
			where: { projectId },
			_max: { number: true },
		});
		const candidate = await tx.candidate.create({
			data: {
				projectId,
				number: (last._max.number || 0) + 1,
				name,
				content,
				contentHash,
				source,
				...importState(content, duplicate),
				...(parseError
					? { importStatus: "failed", importNote: parseError }
					: {}),
			},
		});
		if (attachment)
			await tx.attachment.create({
				data: {
					...attachment,
					kind: "resume",
					projectId,
					candidateId: candidate.id,
				},
			});
		await tx.project.update({
			where: { id: projectId },
			data: { updatedAt: new Date() },
		});
		return candidate;
	});
}
/**
 * 修正姓名或正文，并根据 confirm 决定是否由 HR 显式确认材料可用。
 * confirm 可以放行重复或文本过短的材料，但不能放行空正文。
 * 仅正文变化会清除旧 AI 线索和逐项人工证据；历史最终结论保留，并提示重新检查。
 */
export async function updateCandidateText(
	id: string,
	name: string,
	content: string,
	confirm: boolean,
) {
	return db.$transaction(async (tx) => {
		const c = await tx.candidate.findUniqueOrThrow({ where: { id } });
		const contentHash = hashText(content);
		const duplicate = !!(await tx.candidate.findFirst({
			where: { projectId: c.projectId, contentHash, id: { not: id } },
		}));
		const changed = content !== c.content;
		if (confirm && !content.trim()) throw new Error("请先补充简历文本");
		// 原文改变后，旧引用可能已不存在，所以清除逐项判断；仅修改姓名时不清除正文证据。
		if (changed) await tx.judgment.deleteMany({ where: { candidateId: id } });
		await tx.candidate.update({
			where: { id },
			data: {
				name,
				content,
				contentHash,
				...(confirm
					? { importStatus: "ready", importNote: "" }
					: importState(content, duplicate)),
				...(changed
					? {
							aiResult: Prisma.DbNull,
							aiVersion: null,
							needsReview: !!c.decision,
						}
					: {}),
			},
		});
	});
}
