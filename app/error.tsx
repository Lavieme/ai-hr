"use client";
/**
 * 路由渲染异常时展示的客户端错误边界。
 * reset 由 Next.js 提供，用于重新尝试渲染当前路由；不在界面直接显示内部堆栈。
 */
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
	return (
		<main className="mx-auto max-w-lg space-y-5 px-6 py-24">
			<h1 className="page-title">暂时无法加载工作台</h1>
			<p className="text-muted-foreground">
				请检查数据库连接和迁移状态，或稍后重试。
			</p>
			<Button onClick={reset}>重新加载</Button>
		</main>
	);
}
