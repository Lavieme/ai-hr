"use server";
/**
 * 业务写入统一入口，所有导出函数由 Next.js 作为 Server Actions 在服务端执行。
 * 客户端以 type 区分动作并提交最小输入；服务端重新校验，不信任页面按钮状态或 TypeScript 类型。
 * 文件流、AI 请求和导出使用独立 Route Handler，本模块负责普通表单写入与页面重新验证。
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import {
	COOKIE_NAME,
	SESSION_SECONDS,
	constantEqual,
	createSession,
} from "@/lib/session";
import { db } from "@/lib/db";
import {
	inferCandidateName,
	criteriaSchema,
	reviewSchema,
	assertRecommendation,
} from "@/lib/domain";
import {
	createProject,
	addCandidate,
	replaceCriteria,
	updateCandidateText,
} from "@/lib/projects";
import { removeFiles } from "@/lib/storage";
import { sampleJD, sampleResumes } from "@/lib/sample";
const shortText = z.string().trim().min(1).max(200);
const text = z.string().max(100000);
/**
 * 使用 Zod 可辨识联合限定每类动作的字段，拒绝无效状态和超长文本。
 * version 随评价卡或复核提交，用于检测用户打开页面后发生的标准更新。
 */
const inputSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("create"), name: shortText, jd: text }),
	z.object({ type: z.literal("demo") }),
	z.object({ type: z.literal("delete"), projectId: z.string() }),
	z.object({
		type: z.literal("project"),
		projectId: z.string(),
		name: shortText,
		jd: text,
		blind: z.boolean(),
	}),
	z.object({
		type: z.literal("criteria"),
		projectId: z.string(),
		criteria: criteriaSchema,
		version: z.number().int(),
	}),
	z.object({
		type: z.literal("confirm"),
		projectId: z.string(),
		name: shortText,
		version: z.number().int(),
	}),
	z.object({
		type: z.literal("template-save"),
		projectId: z.string(),
		name: shortText,
	}),
	z.object({
		type: z.literal("template-use"),
		projectId: z.string(),
		templateId: z.string(),
		version: z.number().int(),
	}),
	z.object({
		type: z.literal("paste"),
		projectId: z.string(),
		content: text.min(1),
	}),
	z.object({
		type: z.literal("candidate"),
		id: z.string(),
		name: shortText,
		content: text,
		confirm: z.boolean(),
	}),
	z.object({ type: z.literal("review"), ...reviewSchema.shape }),
	z.object({
		type: z.literal("feedback"),
		projectId: z.string(),
		author: shortText,
		category: z.enum(["extract", "evidence", "standard", "change"]),
		content: z.string().trim().min(1).max(5000),
	}),
]);
/**
 * 由服务端运行时校验规则推导客户端动作类型，减少表单字段与接口字段不一致。
 */
export type ActionInput = z.infer<typeof inputSchema>;
/**
 * 验证共享密码后签发七天会话；配置缺失与密码错误分别带回登录页显示。
 * redirect 属于 Next.js 控制流程，成功签发 Cookie 后跳转首页。
 */
export async function login(form: FormData) {
	const password = String(form.get("password") || "");
	if (
		!process.env.APP_PASSWORD ||
		!process.env.AUTH_SECRET ||
		process.env.AUTH_SECRET.length < 32
	)
		redirect("/login?error=config");
	if (!constantEqual(password, process.env.APP_PASSWORD!))
		redirect("/login?error=password");
	// HttpOnly 防止浏览器脚本读取会话；SameSite=Lax 限制跨站 Cookie 发送。
	// 生产默认 Secure，本地 HTTP 可通过 COOKIE_SECURE=false 显式关闭 Secure 标志。
	(await cookies()).set(COOKIE_NAME, createSession(), {
		httpOnly: true,
		sameSite: "lax",
		secure: process.env.COOKIE_SECURE
			? process.env.COOKIE_SECURE === "true"
			: process.env.NODE_ENV === "production",
		path: "/",
		maxAge: SESSION_SECONDS,
	});
	redirect("/");
}
/**
 * 删除当前浏览器的会话 Cookie 并返回登录页；共享工作台的数据不会被退出操作删除。
 */
export async function logout() {
	(await cookies()).delete(COOKIE_NAME);
	redirect("/login");
}
/**
 * 执行已登录用户的一次业务操作，并返回客户端可显示的结果。
 * 新建项目时返回 id 供页面跳转；其他动作成功后重新验证相关页面的数据缓存。
 * 认证在 try/catch 外执行，防止把登录重定向误当业务异常转成普通错误。
 */
export async function mutate(
	raw: ActionInput,
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
	await requireAuth();
	try {
		// 客户端可以绕开界面直接调用动作，因此必须在这里执行真实的输入校验。
		const input = inputSchema.parse(raw);
		let id: string | undefined;
		switch (input.type) {
			// 新项目连同规则初稿和 V1 快照一起创建。
			case "create":
				id = (await createProject(input.name, input.jd)).id;
				break;
			// 每次体验都创建独立项目副本，避免改写已有的示例项目或其他用户的筛选记录。
			case "demo": {
				const p = await createProject("校招产品经理 · 示例", sampleJD);
				for (const c of sampleResumes)
					await addCandidate(p.id, c.name, c.content, "示例材料");
				id = p.id;
				break;
			}
			// 先尝试删除 S3 原件，成功后再删除项目；数据库关联记录按模型中的级联规则清理。
			// S3 与 PostgreSQL 不属于同一事务，不能将两者视为可原子回滚的操作。
			case "delete": {
				const files = await db.attachment.findMany({
					where: { projectId: input.projectId },
				});
				await removeFiles(files.map((f) => f.key));
				await db.project.delete({ where: { id: input.projectId } });
				break;
			}
			// 这里只保存岗位材料和盲筛开关；修改 JD 不会隐式替换 HR 已编辑的评价卡。
			case "project": {
				await db.project.update({
					where: { id: input.projectId },
					data: { name: input.name, jd: input.jd, blind: input.blind },
				});
				break;
			}
			// 手动编辑评价卡与应用模板共用 replaceCriteria，统一管理新版本及旧结果失效。
			case "criteria":
				await replaceCriteria(input.projectId, input.criteria, input.version);
				break;
			// 用带版本条件的更新记录经理确认；零行更新表示页面对应的版本已经过期。
			case "confirm": {
				const result = await db.project.updateMany({
					where: { id: input.projectId, version: input.version },
					data: { confirmedBy: input.name, confirmedAt: new Date() },
				});
				if (!result.count) throw new Error("评价卡已更新，请刷新后确认");
				break;
			}
			// 模板保存当前已生效标准，不保存尚在浏览器中的草稿，也不保留原项目的标准 id。
			case "template-save": {
				const p = await db.project.findUniqueOrThrow({
					where: { id: input.projectId },
					include: { criteria: { orderBy: { position: "asc" } } },
				});
				await db.template.create({
					data: {
						name: input.name,
						criteria: p.criteria.map(({ title, evidence, importance }) => ({
							title,
							evidence,
							importance,
						})),
					},
				});
				break;
			}
			// 模板内容从数据库读取并重新校验，应用后按正常修订创建新版本。
			case "template-use": {
				const t = await db.template.findUniqueOrThrow({
					where: { id: input.templateId },
				});
				await replaceCriteria(
					input.projectId,
					criteriaSchema.parse(t.criteria),
					input.version,
				);
				break;
			}
			// 以单独一行 --- 切分多份简历，忽略空分段，再逐份复用统一的材料导入逻辑。
			case "paste": {
				const chunks = input.content
					.split(/^---\s*$/m)
					.map((s) => s.trim())
					.filter(Boolean);
				if (chunks.length > 50) throw new Error("每次最多粘贴 50 份简历");
				for (const content of chunks) {
					const first = content.split("\n")[0].split(/[|｜]/)[0].trim();
					await addCandidate(
						input.projectId,
						inferCandidateName(content, first.slice(0, 30) || "候选人"),
						content,
						"文本粘贴",
					);
				}
				break;
			}
			// 材料修正和显式确认是否可复核由数据层统一处理，避免页面绕过失效规则。
			case "candidate":
				await updateCandidateText(
					input.id,
					input.name,
					input.content,
					input.confirm,
				);
				break;
			// 逐项判断与最终结论必须一起保存，避免出现“结论已提交但证据仍是旧数据”的中间状态。
			case "review": {
				await db.$transaction(async (tx) => {
					const candidate = await tx.candidate.findUniqueOrThrow({
						where: { id: input.candidateId },
					});
					// 使用与评价卡修订相同的项目行锁；持锁后重读材料和标准，按本次实际看到的数据库状态校验。
					await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${candidate.projectId} FOR UPDATE`;
					const current = await tx.candidate.findUniqueOrThrow({
						where: { id: candidate.id },
					});
					const project = await tx.project.findUniqueOrThrow({
						where: { id: current.projectId },
						include: { criteria: true },
					});
					if (project.version !== input.version)
						throw new Error("评价卡已更新，请刷新后重新复核");
					if (current.importStatus !== "ready")
						throw new Error("请先确认材料可用");
					// 判断只能引用当前项目的评价标准，且每项最多提交一次。
					const ids = new Set(project.criteria.map((c) => c.id));
					if (
						input.judgments.some((j) => !ids.has(j.criterionId)) ||
						new Set(input.judgments.map((j) => j.criterionId)).size !==
							input.judgments.length
					)
						throw new Error("无效的评价标准");
					// 逐字引用检查在服务端执行，防止编辑后的片段或伪造文本被保存为已核实证据。
					for (const j of input.judgments) {
						if (j.quote && !current.content.includes(j.quote))
							throw new Error("引用证据必须逐字来自简历原文");
						if (j.status === "evidence" && !j.quote.trim())
							throw new Error("确认有证据时，请填写对应原文");
					}
					assertRecommendation(input.decision, input.reason, input.judgments);
					// 用本次表单完整替换逐项判断；未提交的旧判断不应悄悄残留。
					await tx.judgment.deleteMany({ where: { candidateId: current.id } });
					await tx.judgment.createMany({
						data: input.judgments.map((j) => ({
							...j,
							candidateId: current.id,
						})),
					});
					await tx.candidate.update({
						where: { id: current.id },
						data: {
							decision: input.decision,
							reason: input.reason,
							reviewedAt: new Date(),
							// 只有一次通过校验的人工复核可以清除重新检查标记，AI 提取本身不能清除它。
							needsReview: false,
						},
					});
					await tx.project.update({
						where: { id: project.id },
						data: { updatedAt: new Date() },
					});
				});
				break;
			}
			// 反馈仅记录问题与反馈人，不自动修改标准或候选人结论。
			case "feedback":
				await db.feedback.create({
					data: {
						projectId: input.projectId,
						author: input.author,
						type: input.category,
						content: input.content,
					},
				});
				break;
		}
		// 更新首页统计与相关项目页面，使后续服务端渲染读到最新记录。
		// 候选人动作只携带候选人 id，因此按动态路由模式重新验证项目页。
		revalidatePath("/");
		if ("projectId" in input) revalidatePath(`/projects/${input.projectId}`);
		if ("candidateId" in input || input.type === "candidate")
			revalidatePath("/projects/[id]", "page");
		return { ok: true, id };
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Mutation failed");
		return {
			ok: false,
			error:
				error instanceof z.ZodError
					? "请检查必填内容和文字长度"
					: error instanceof Error
						? error.message
						: "操作失败，请重试",
		};
	}
}
