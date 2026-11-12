/**
 * 测试使用 Node 环境，与服务端解析、加密和数据库接口一致。
 * server-only 映射仅供测试；Next 生产构建仍执行服务端模块边界检查。
 * 禁止测试文件并行执行，避免环境变量及数据库连接状态互相影响。
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL(".", import.meta.url)),
			"server-only": fileURLToPath(
				new URL("./tests/server-only.ts", import.meta.url),
			),
		},
	},
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		fileParallelism: false,
	},
});
