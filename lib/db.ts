/**
 * 应用共享的 Prisma 数据访问入口，仅在服务端使用。
 * Prisma 7 通过 PostgreSQL 驱动适配器访问数据库；业务模块统一导入 db，避免各自创建连接池。
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
// 开发时 Next.js 热更新会重新求值模块，将客户端保存在 globalThis 上可复用已有连接池。
// 生产环境依赖进程内的模块缓存，不将实例额外挂到全局对象。
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const db =
	globalDb.prisma ??
	new PrismaClient({
		adapter: new PrismaPg({
			connectionString: process.env.DATABASE_URL,
			// 连接池获取数据库连接最多等待 5 秒，连接失败后由页面或接口的错误处理接管。
			connectionTimeoutMillis: 5000,
		}),
	});
if (process.env.NODE_ENV !== "production") globalDb.prisma = db;
