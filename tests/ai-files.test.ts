/**
 * AI 与文件解析的单元验证。模拟 fetch 响应覆盖有效结果、超时及无效结构，不调用真实供应商。
 * 每项测试后恢复环境变量和全局模拟，避免配置泄漏影响其他用例。
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { validateEvidence, draftCriteria, extractEvidence } from "@/lib/ai";
import { validateFile, extractText } from "@/lib/files";
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});
describe("AI 返回校验及失败处理", () => {
	it("拒绝捏造证据、未知标准和缺失标准", () => {
		const result = {
			items: [
				{
					criterionId: "a",
					quotes: ["负责用户访谈"],
					missing: "",
					question: "",
				},
			],
		};
		expect(validateEvidence(result, "我负责用户访谈。", ["a"])).toEqual(result);
		expect(() => validateEvidence(result, "没有这句话", ["a"])).toThrow(
			"无法在简历原文",
		);
		expect(() => validateEvidence(result, "负责用户访谈", ["b"])).toThrow(
			"无效的评价标准",
		);
		expect(() => validateEvidence({ items: [] }, "原文", ["a"])).toThrow(
			"完整",
		);
	});
	it("使用模拟 OpenAI 响应生成草稿和逐项证据", async () => {
		vi.stubEnv("AI_API_KEY", "test-key");
		vi.stubEnv("AI_BASE_URL", "https://example.test/v1");
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					choices: [
						{
							message: {
								content: JSON.stringify({
									criteria: [
										{
											title: "用户访谈",
											evidence: "个人行动",
											importance: "core",
										},
									],
								}),
							},
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					choices: [
						{
							message: {
								content: JSON.stringify({
									items: [
										{
											criterionId: "a",
											quotes: ["负责用户访谈"],
											missing: "",
											question: "如何验证？",
										},
									],
								}),
							},
						},
					],
				}),
			);
		vi.stubGlobal("fetch", fetch);
		expect((await draftCriteria("产品经理")).length).toBe(1);
		expect(
			(
				await extractEvidence("负责用户访谈", [
					{ id: "a", title: "访谈", evidence: "行动" },
				])
			).items[0].quotes,
		).toEqual(["负责用户访谈"]);
		expect(fetch.mock.calls[0][0]).toBe(
			"https://example.test/v1/chat/completions",
		);
	});
	it("保留供应商的接口前缀，不擅自追加 v1，并明确提示认证失败", async () => {
		vi.stubEnv("AI_API_KEY", "test-key");
		vi.stubEnv("AI_BASE_URL", "https://example.test/openai/");
		const fetch = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
		vi.stubGlobal("fetch", fetch);
		await expect(draftCriteria("测试岗位 JD")).rejects.toThrow(
			"API Key 与 Base URL",
		);
		expect(fetch.mock.calls[0][0]).toBe(
			"https://example.test/openai/chat/completions",
		);
	});
	it("处理超时、非 JSON、无效结构和服务错误", async () => {
		vi.stubEnv("AI_API_KEY", "test-key");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")),
		);
		await expect(draftCriteria("JD")).rejects.toThrow("Timed out");
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json({ choices: [{ message: { content: "not json" } }] }),
				),
		);
		await expect(draftCriteria("JD")).rejects.toThrow("无效 JSON");
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json({ choices: [{ message: { content: "{}" } }] }),
				),
		);
		await expect(draftCriteria("JD")).rejects.toThrow();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("", { status: 503 })),
		);
		await expect(draftCriteria("JD")).rejects.toThrow("503");
	});
});
describe("文件导入边界", () => {
	it("校验格式和 15 MB 大小限制", () => {
		expect(validateFile({ name: "resume.PDF", size: 100 })).toBe("pdf");
		expect(() => validateFile({ name: "resume.zip", size: 100 })).toThrow(
			"仅支持",
		);
		expect(() =>
			validateFile({ name: "resume.pdf", size: 16 * 1024 * 1024 }),
		).toThrow("15 MB");
	});
	it("解析文本、去空字符，拒绝超过限制的正文", async () => {
		expect(await extractText(Buffer.from(" 简历\u0000正文 "), "txt")).toBe(
			"简历正文",
		);
		await expect(
			extractText(Buffer.from("a".repeat(100001)), "md"),
		).rejects.toThrow("10 万字");
	});
});

describe("真实文件解析", () => {
	it("提取 DOCX 原文", async () => {
		const { readFile } = await import("node:fs/promises");
		expect(
			await extractText(
				await readFile(new URL("./fixtures/resume.docx", import.meta.url)),
				"docx",
			),
		).toContain("林沐负责用户访谈");
	});
	it("提取文本 PDF；扫描或空白 PDF 不伪造文字", async () => {
		const { makePdf } = await import("./pdf-fixture");
		expect(await extractText(makePdf(), "pdf")).toContain(
			"Candidate led user research",
		);
		expect(await extractText(makePdf(1, true), "pdf")).toBe("");
	});
	it("拒绝超过 12 页和损坏的 PDF", async () => {
		const { makePdf } = await import("./pdf-fixture");
		await expect(extractText(makePdf(13), "pdf")).rejects.toThrow("12 页");
		await expect(
			extractText(Buffer.from("invalid pdf"), "pdf"),
		).rejects.toThrow();
	});
});
