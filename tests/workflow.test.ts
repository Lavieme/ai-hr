/**
 * 使用真实 PostgreSQL 验证服务端完整工作流，仅提供 TEST_DATABASE_URL 时运行。
 * 模拟 Next Cookie、缓存刷新及重定向边界，使 Server Actions 可以在 Node 测试环境直接执行。
 * AI 请求采用模拟结果；清理范围限定为本组创建的项目和模板。
 */
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => {
	if (process.env.TEST_DATABASE_URL)
		process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
	process.env.AUTH_SECRET = "workflow-test-secret-at-least-32-characters";
	process.env.APP_PASSWORD = "test";
	return { token: undefined as string | undefined };
});
vi.mock("next/headers", () => ({
	cookies: async () => ({
		get: () => (state.token ? { value: state.token } : undefined),
	}),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
	redirect: (url: string) => {
		throw new Error(`REDIRECT:${url}`);
	},
}));
import { db } from "@/lib/db";
import { mutate } from "@/app/actions";
import { createSession } from "@/lib/session";
import { getProject } from "@/lib/projects";
import { GET as exportProject } from "@/app/api/projects/[id]/export/route";
import { POST as aiRoute } from "@/app/api/projects/[id]/ai/route";
import { POST as uploadRoute } from "@/app/api/upload/route";
import { GET as downloadRoute } from "@/app/api/attachments/[id]/route";
import { sampleJD, sampleResumes } from "@/lib/sample";
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("PostgreSQL 完整工作流（仅 TEST_DATABASE_URL）", () => {
	let id = "";
	let candidateId = "";
	let templateId = "";
	beforeAll(() => {
		state.token = createSession();
	});
	afterAll(async () => {
		if (id) await db.project.deleteMany({ where: { id } });
		if (templateId) await db.template.deleteMany({ where: { id: templateId } });
		await db.$disconnect();
	});
	it("未登录不能调用写入、上传、AI、导出或下载", async () => {
		state.token = undefined;
		await expect(
			mutate({ type: "create", name: "test", jd: "" }),
		).rejects.toThrow("REDIRECT:/login");
		expect(
			(
				await exportProject(new Request("http://localhost/api/export"), {
					params: Promise.resolve({ id: "missing" }),
				})
			).status,
		).toBe(401);
		expect(
			(
				await aiRoute(
					new Request("http://localhost/api/ai", { method: "POST" }),
					{ params: Promise.resolve({ id: "missing" }) },
				)
			).status,
		).toBe(401);
		expect(
			(
				await uploadRoute(
					new Request("http://localhost/api/upload", { method: "POST" }),
				)
			).status,
		).toBe(401);
		expect(
			(
				await downloadRoute(new Request("http://localhost/api/file"), {
					params: Promise.resolve({ id: "missing" }),
				})
			).status,
		).toBe(401);
		state.token = createSession();
	});
	it("创建岗位、粘贴简历、检测重复、修正并确认材料可用", async () => {
		const created = await mutate({
			type: "create",
			name: "集成测试岗位",
			jd: sampleJD,
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		id = created.id!;
		await mutate({
			type: "paste",
			projectId: id,
			content: sampleResumes[0].content + "\n---\n" + sampleResumes[0].content,
		});
		let p = (await getProject(id))!;
		expect(p.candidates.map((c) => c.importStatus)).toEqual([
			"ready",
			"duplicate",
		]);
		candidateId = p.candidates[0].id;
		await mutate({
			type: "candidate",
			id: p.candidates[1].id,
			name: "人工核对材料",
			content: p.candidates[1].content,
			confirm: true,
		});
		p = (await getProject(id))!;
		expect(p.candidates[1].importStatus).toBe("ready");
	});
	it("保存模板与人工经理确认，记录结构化 AI 证据且不改变结论", async () => {
		let p = (await getProject(id))!;
		expect(
			(
				await mutate({
					type: "confirm",
					projectId: id,
					name: "测试经理",
					version: p.version,
				})
			).ok,
		).toBe(true);
		await mutate({
			type: "template-save",
			projectId: id,
			name: "集成测试模板",
		});
		const t = await db.template.findFirstOrThrow({
			where: { name: "集成测试模板" },
			orderBy: { createdAt: "desc" },
		});
		templateId = t.id;
		vi.stubEnv("AI_API_KEY", "mock-key");
		const result = {
			items: p.criteria.map((cr) => ({
				criterionId: cr.id,
				quotes: ["负责需求梳理与原型设计"],
				missing: "",
				question: "请说明方案取舍",
			})),
		};
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				Response.json({
					choices: [{ message: { content: JSON.stringify(result) } }],
				}),
			),
		);
		const r = await aiRoute(
			new Request("http://localhost/api/ai", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ kind: "evidence", candidateId }),
			}),
			{ params: Promise.resolve({ id }) },
		);
		expect(r.status).toBe(200);
		p = (await getProject(id))!;
		expect(p.candidates[0].aiVersion).toBe(p.version);
		expect(p.candidates[0].decision).toBeNull();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});
	it("AI 失败保留已有证据，上传失败不产生候选人", async () => {
		const previous = (await getProject(id))!;
		vi.stubEnv("AI_API_KEY", "mock-key");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("", { status: 503 })),
		);
		expect(
			(
				await aiRoute(
					new Request("http://localhost/api/ai", {
						method: "POST",
						body: JSON.stringify({ kind: "evidence", candidateId }),
					}),
					{ params: Promise.resolve({ id }) },
				)
			).status,
		).toBe(400);
		expect((await getProject(id))!.candidates[0].aiResult).toEqual(
			previous.candidates[0].aiResult,
		);
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		vi.stubEnv("OSS_ACCESS_KEY_ID", "");
		vi.stubEnv("OSS_SECRET_ACCESS_KEY", "");
		const f = new FormData();
		f.set("projectId", id);
		f.set("kind", "resume");
		f.set("file", new File(["text"], "resume.txt"));
		expect(
			(
				await uploadRoute(
					new Request("http://localhost/api/upload", {
						method: "POST",
						body: f,
					}),
				)
			).status,
		).toBe(400);
		expect((await getProject(id))!.candidates.length).toBe(
			previous.candidates.length,
		);
		vi.unstubAllEnvs();
	});
	it("人工推荐校验证据、导出脱敏并只包含人工推荐", async () => {
		const p = (await getProject(id))!;
		const cr = p.criteria[0];
		const base = {
			type: "review" as const,
			candidateId,
			version: p.version,
			decision: "interview" as const,
			reason: "",
			judgments: [],
		};
		expect((await mutate(base)).ok).toBe(false);
		expect(
			(
				await mutate({
					...base,
					judgments: [
						{
							criterionId: cr.id,
							status: "evidence",
							quote: "不存在的证据",
							note: "",
							followup: "",
						},
					],
				})
			).ok,
		).toBe(false);
		expect(
			(
				await mutate({
					...base,
					reason: "林沐具备需求分析和研发协作经验",
					judgments: [
						{
							criterionId: cr.id,
							status: "evidence",
							quote: "负责需求梳理与原型设计",
							note: "人工已核对",
							followup: "说明具体方案取舍",
						},
					],
				})
			).ok,
		).toBe(true);
		const exported = await exportProject(
			new Request("http://localhost/api/export?kind=csv"),
			{ params: Promise.resolve({ id }) },
		);
		const csv = await exported.text();
		expect(csv).toContain("C-001");
		expect(csv).not.toContain("林沐");
		expect(csv).not.toContain("C-002");
	});
	it("评价卡修订使旧 AI 失效并提示复核，拒绝旧版本写入", async () => {
		const p = (await getProject(id))!;
		expect(
			(
				await mutate({
					type: "template-use",
					projectId: id,
					templateId,
					version: p.version,
				})
			).ok,
		).toBe(true);
		const next = (await getProject(id))!;
		expect(next.version).toBe(p.version + 1);
		expect(next.confirmedAt).toBeNull();
		expect(next.candidates[0].needsReview).toBe(true);
		expect(next.candidates[0].aiResult).toBeNull();
		expect(next.candidates[0].decision).toBe("interview");
		expect(next.versions.length).toBe(2);
		expect(
			(
				await mutate({
					type: "criteria",
					projectId: id,
					criteria: [{ title: "test", evidence: "test", importance: "core" }],
					version: p.version,
				})
			).ok,
		).toBe(false);
		const csv = await (
			await exportProject(new Request("http://localhost/api/export?kind=csv"), {
				params: Promise.resolve({ id }),
			})
		).text();
		expect(csv).toContain("需要重新检查");
	});
	it("原文修改清除 AI 和逐项旧证据，反馈持久化", async () => {
		const p = (await getProject(id))!;
		await mutate({
			type: "candidate",
			id: candidateId,
			name: "林沐",
			content: p.candidates[0].content + "\n补充个人贡献说明。",
			confirm: true,
		});
		await mutate({
			type: "feedback",
			projectId: id,
			category: "evidence",
			author: "测试经理",
			content: "需要核实个人贡献",
		});
		const latest = (await getProject(id))!;
		expect(latest.candidates[0].judgments).toHaveLength(0);
		expect(latest.candidates[0].aiResult).toBeNull();
		expect(latest.candidates[0].needsReview).toBe(true);
		expect(latest.feedback).toHaveLength(1);
	});
});
