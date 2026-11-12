/**
 * Prisma CLI 的模型、迁移及种子入口，数据库 URL 从环境变量读取。
 * 本地默认连接仅便于开发；生产和迁移任务必须注入目标数据库配置。
 */
import "dotenv/config";
import { defineConfig } from "prisma/config";
export default defineConfig({
	schema: "prisma/schema.prisma",
	migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
	datasource: {
		url:
			process.env.DATABASE_URL ||
			"postgresql://postgres:postgres@localhost:5432/ai_hr",
	},
});
