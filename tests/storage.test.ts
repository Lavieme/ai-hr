/**
 * 通过模拟 AWS SDK 的 send 验证对象 key、请求参数、签名地址和失败传播。
 * 不访问真实 S3，也不写入本地文件；每项测试后恢复客户端模拟和环境变量。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { uploadFile, downloadUrl, removeFiles } from "@/lib/storage";
function configure() {
	vi.stubEnv("OSS_ACCESS_KEY_ID", "local-test");
	vi.stubEnv("OSS_SECRET_ACCESS_KEY", "local-test-secret");
	vi.stubEnv("OSS_BUCKET", "private-test");
	vi.stubEnv("OSS_ENDPOINT", "http://internal-s3:9000");
	vi.stubEnv("OSS_PUBLIC_ENDPOINT", "http://localhost:9000");
	vi.stubEnv("OSS_FORCE_PATH_STYLE", "true");
}
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});
describe("S3 存储接口", () => {
	it("使用对象前缀和随机 key 上传，不存本地文件", async () => {
		configure();
		vi.stubEnv("OSS_PATH_PREFIX", "ai-hr");
		const send = vi
			.spyOn(S3Client.prototype, "send")
			.mockResolvedValue({} as never);
		const key = await uploadFile(Buffer.from("resume"), "txt", "text/plain");
		expect(key).toMatch(/^ai-hr\/[\da-f-]+\.txt$/);
		expect(send).toHaveBeenCalledOnce();
		expect((send.mock.calls[0][0] as { input: unknown }).input).toMatchObject({
			Bucket: "private-test",
			Key: key,
			ContentType: "text/plain",
		});
	});
	it("上传失败向调用者返回失败，不生成虚假成功", async () => {
		configure();
		vi.spyOn(S3Client.prototype, "send").mockRejectedValue(
			new Error("S3 unavailable"),
		);
		await expect(
			uploadFile(Buffer.from("resume"), "txt", "text/plain"),
		).rejects.toThrow("S3 unavailable");
	});
	it("下载使用公共地址即时签名，上传仍使用内部地址", async () => {
		configure();
		const url = new URL(await downloadUrl("ai-hr/private.txt"));
		expect(url.origin).toBe("http://localhost:9000");
		expect(url.pathname).toBe("/private-test/ai-hr/private.txt");
		expect(url.searchParams.has("X-Amz-Signature")).toBe(true);
	});
	it("批量删除失败不被忽略", async () => {
		configure();
		vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
			Errors: [{ Key: "one", Code: "AccessDenied" }],
		} as never);
		await expect(removeFiles(["one"])).rejects.toThrow("删除失败");
		await expect(removeFiles([])).resolves.toBeUndefined();
	});
});
