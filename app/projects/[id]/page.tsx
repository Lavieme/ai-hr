/**
 * 单个项目工作台的服务端入口。
 * 读取项目、模板选项与功能配置状态，交给客户端 Workbench 管理当前标签页和编辑草稿。
 */
import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { db } from "@/lib/db";
import { storageConfigured } from "@/lib/storage";
import { aiConfigured } from "@/lib/ai";
import { Header } from "@/components/header";
import { Workbench } from "@/components/workbench";
export const dynamic = "force-dynamic";
/**
 * params 是异步路由参数；先鉴权再查询，避免未登录时读取项目。
 * 项目不存在使用 Next.js 的 notFound 进入统一缺失页面。
 */
export default async function ProjectPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	await requireAuth();
	const p = await getProject((await params).id);
	if (!p) notFound();
	// 下拉框只传模板标识和名称；模板正文在实际应用时由 Server Action 读取。
	const templates = await db.template.findMany({
		select: { id: true, name: true },
		orderBy: { createdAt: "desc" },
	});
	// JSON 序列化将嵌套 Date 转成字符串，与 lib/types.ts 的 WorkProject 类型保持一致。
	// 功能开关只传布尔值，不把 AI 密钥、数据库地址或 S3 凭据交给客户端。
	// 完整项目仍含原始材料，盲筛在此是共享工作台的展示模式，不是用户之间的数据隔离。
	return (
		<>
			<Header />
			<Workbench
				project={JSON.parse(JSON.stringify(p))}
				templates={templates}
				storageEnabled={storageConfigured()}
				aiEnabled={aiConfigured()}
			/>
		</>
	);
}
