/**
 * 真实 PostgreSQL 与 S3 兼容存储的集成验证。仅同时提供 TEST_DATABASE_URL 和 TEST_S3_ENDPOINT 时运行。
 * Cookie 使用测试会话，文件和项目使用独立测试数据；结束后清理本次创建的记录和对象。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => {
	if (process.env.TEST_DATABASE_URL)
		process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
	process.env.AUTH_SECRET = "storage-workflow-secret-at-least-32-characters";
	process.env.APP_PASSWORD = "test";
	return { token: "" };
});
vi.mock("next/headers", () => ({
	cookies: async () => ({ get: () => ({ value: state.token }) }),
}));
import { createSession } from "@/lib/session";
import { db } from "@/lib/db";
import { createProject, getProject } from "@/lib/projects";
import { POST as upload } from "@/app/api/upload/route";
import { GET as download } from "@/app/api/attachments/[id]/route";
import { removeFiles } from "@/lib/storage";
import { sampleResumes } from "@/lib/sample";
import { makePdf } from "./pdf-fixture";
const integration =
	process.env.TEST_DATABASE_URL && process.env.TEST_S3_ENDPOINT
		? describe
		: describe.skip;
integration("真实 MinIO 兼容存储与 PostgreSQL", () => {
	let id = "";
	beforeAll(async () => {
		state.token = createSession();
		vi.stubEnv(
			"OSS_ACCESS_KEY_ID",
			process.env.TEST_S3_ACCESS_KEY_ID || "minioadmin",
		);
		vi.stubEnv(
			"OSS_SECRET_ACCESS_KEY",
			process.env.TEST_S3_SECRET_ACCESS_KEY || "minioadmin123",
		);
		vi.stubEnv("OSS_BUCKET", process.env.TEST_S3_BUCKET || "ai-hr");
		vi.stubEnv("OSS_ENDPOINT", process.env.TEST_S3_ENDPOINT!);
		vi.stubEnv("OSS_PUBLIC_ENDPOINT", process.env.TEST_S3_ENDPOINT!);
		vi.stubEnv("OSS_FORCE_PATH_STYLE", "true");
		vi.stubEnv("OSS_PATH_PREFIX", "ai-hr-test");
		id = (await createProject("S3 集成测试", "产品经历")).id;
	});
	afterAll(async () => {
		if (id) {
			const p = await getProject(id);
			await removeFiles(p?.attachments.map((a) => a.key) || []);
			await db.project.deleteMany({ where: { id } });
		}
		await db.$disconnect();
		vi.unstubAllEnvs();
	});
	async function send(name: string, buffer: Buffer, kind = "resume") {
		const form = new FormData();
		form.set("projectId", id);
		form.set("kind", kind);
		form.set("file", new File([new Uint8Array(buffer)], name));
		return upload(
			new Request("http://localhost/api/upload", {
				method: "POST",
				body: form,
			}),
		);
	}
	it("上传原件并关联候选人，盲筛禁止下载，关闭后签名下载正文一致", async () => {
		const content = sampleResumes[0].content;
		expect((await send("resume.txt", Buffer.from(content))).status).toBe(200);
		const p = (await getProject(id))!;
		expect(p.candidates[0].content).toBe(content);
		expect(p.candidates[0].name).toBe("林沐");
		expect(p.attachments).toHaveLength(1);
		const attachment = p.attachments[0];
		expect(attachment.key).toMatch(/^ai-hr-test\//);
		expect(
			(
				await download(new Request("http://localhost/api/file"), {
					params: Promise.resolve({ id: attachment.id }),
				})
			).status,
		).toBe(403);
		await db.project.update({ where: { id }, data: { blind: false } });
		const response = await download(new Request("http://localhost/api/file"), {
			params: Promise.resolve({ id: attachment.id }),
		});
		expect(response.status).toBe(302);
		const original = await fetch(response.headers.get("location")!);
		expect(original.ok).toBe(true);
		expect(await original.text()).toBe(content);
	});
	it("扫描 PDF 与损坏 DOCX 保留原件并标记为待人工补充", async () => {
		const scan = await send("扫描.pdf", makePdf(1, true));
		expect(scan.status).toBe(200);
		expect((await scan.json()).warning).toContain("没有提取");
		const broken = await send("损坏.docx", Buffer.from("broken docx"));
		expect(broken.status).toBe(200);
		const p = (await getProject(id))!;
		expect(
			p.candidates.slice(1).every((c) => c.importStatus === "failed"),
		).toBe(true);
		expect(p.attachments).toHaveLength(3);
	});
});
