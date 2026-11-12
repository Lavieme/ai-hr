/**
 * 项目首页的服务端入口。
 * 请求先经过会话校验，再读取数据库并整理成轻量的项目卡片数据；浏览器只负责交互和展示。
 */
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Header } from "@/components/header";
import { Home } from "@/components/home";
/**
 * 每次请求都读取当前共享工作台数据，避免把登录状态或项目统计静态预渲染。
 */
export const dynamic = "force-dynamic";
/**
 * 读取按最近更新时间排列的项目，并计算首页统计需要的候选人数量。
 * 已有结论但 needsReview 为 true 的候选人重新计入待复核，不计入已完成复核。
 */
export default async function Page() {
	await requireAuth();
	// 统计只依赖结论、材料状态和重新检查标记，因此不读取首页用不到的简历正文与 AI 结果。
	const projects = await db.project.findMany({
		orderBy: { updatedAt: "desc" },
		include: {
			candidates: {
				select: { decision: true, importStatus: true, needsReview: true },
			},
		},
	});
	// 下方映射只向 Home 传递卡片字段；日期统一转换成 ISO 字符串，统计留在服务端计算。
	return (
		<>
			<Header />
			<Home
				projects={projects.map((p) => ({
					id: p.id,
					name: p.name,
					updatedAt: p.updatedAt.toISOString(),
					total: p.candidates.length,
					done: p.candidates.filter((c) => c.decision && !c.needsReview).length,
					pending: p.candidates.filter(
						(c) => c.importStatus === "ready" && (!c.decision || c.needsReview),
					).length,
				}))}
			/>
		</>
	);
}
