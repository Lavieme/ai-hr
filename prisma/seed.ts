/**
 * 可重复运行的示例数据初始化入口。
 * 直接使用 Prisma 客户端，不依赖 Next.js 请求上下文；仅在固定项目标识不存在时创建材料。
 */
import { hashText } from "../lib/hash";
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { ruleCriteria } from "../lib/domain";
import { sampleJD, sampleResumes } from "../lib/sample";
// 初始化命令是独立进程，因此自行创建客户端；结束时在 finally 中关闭连接，避免命令一直挂起。
const db = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
try {
	const criteria = ruleCriteria(sampleJD);
	await db.project.upsert({
		where: { id: "demo-campus-product" },
		// 固定 id 配合空更新实现幂等：再次执行不会覆盖 HR 对既有示例项目做过的修改。
		update: {},
		create: {
			id: "demo-campus-product",
			name: "校招产品经理 · 示例",
			jd: sampleJD,
			criteria: { create: criteria.map((c, position) => ({ ...c, position })) },
			// 初始标准、版本快照和候选人通过一次嵌套写入创建，编号及文本指纹与普通导入保持一致。
			versions: { create: { version: 1, snapshot: criteria } },
			candidates: {
				create: sampleResumes.map((c, i) => ({
					...c,
					number: i + 1,
					source: "示例材料",
					contentHash: hashText(c.content),
				})),
			},
		},
	});
	console.log("示例数据已就绪（不会覆盖已有修改）");
} finally {
	await db.$disconnect();
}
