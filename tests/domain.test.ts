/**
 * 验证不依赖数据库的招聘规则，以及会话签名和 CSV 安全处理。
 * 重点覆盖盲筛、重复识别、人工推荐约束等业务边界。
 */
import { describe, it, expect } from "vitest";
import { hashText } from "@/lib/hash";
import {
	inferCandidateName,
	importState,
	mask,
	ruleCriteria,
	assertRecommendation,
	csvCell,
} from "@/lib/domain";
import { createSession, verifySession } from "@/lib/session";
describe("招聘材料与人工推荐规则", () => {
	it("从通用文件名的简历正文识别姓名用于盲筛", () => {
		expect(inferCandidateName("林沐 | 海城大学\n项目经历", "resume")).toBe(
			"林沐",
		);
		expect(inferCandidateName("个人简历\n姓名：林沐\n项目经历", "resume")).toBe(
			"林沐",
		);
	});
	it("规范化重复检测，但不把空白材料当成可用简历", () => {
		expect(hashText("Hello\n World")).toBe(hashText("hello world"));
		expect(importState("", false).importStatus).toBe("failed");
		expect(importState("短文本", false).importStatus).toBe("incomplete");
		expect(importState("a".repeat(100), true).importStatus).toBe("duplicate");
	});
	it("按 JD 分段生成有优先级的可编辑规则", () => {
		expect(
			ruleCriteria(
				"岗位职责\n- 分析需求\n任职要求\n- 个人贡献\n加分项\n- AI 实践",
			).map((c) => c.importance),
		).toEqual(["core", "must", "bonus"]);
	});
	it("盲筛隐藏姓名、邮箱、电话和院校", () => {
		const text = "林沐 海城大学 13812345678 lin@example.com";
		const masked = mask(text, "林沐", true);
		for (const value of ["林沐", "海城大学", "13812345678", "lin@example.com"])
			expect(masked).not.toContain(value);
		expect(mask(text, "林沐", false)).toBe(text);
	});
	it("人工推荐必须有已核实原文证据或具体依据", () => {
		expect(() => assertRecommendation("interview", "", [])).toThrow();
		expect(() =>
			assertRecommendation("interview", "已验证项目贡献", []),
		).not.toThrow();
		expect(() =>
			assertRecommendation("interview", "", [
				{ status: "evidence", quote: "项目原文" },
			]),
		).not.toThrow();
		expect(() => assertRecommendation("more", "", [])).not.toThrow();
	});
	it("CSV 转义引号并防止单元格公式执行", () => {
		expect(csvCell('a"b')).toBe('"a""b"');
		expect(csvCell('=HYPERLINK("x")')).toContain("'=HYPERLINK");
	});
});
describe("共享密码会话", () => {
	it("验证签名、过期和篡改", () => {
		process.env.AUTH_SECRET = "test-secret-must-be-at-least-32-characters";
		process.env.APP_PASSWORD = "test";
		const now = Date.now();
		const token = createSession(now);
		expect(verifySession(token, now)).toBe(true);
		expect(verifySession(token + "x", now)).toBe(false);
		expect(verifySession(token, now + 8 * 86400000)).toBe(false);
		delete process.env.APP_PASSWORD;
		expect(verifySession(token, now)).toBe(false);
	});
});
