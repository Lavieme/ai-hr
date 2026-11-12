/**
 * 路由等待服务端数据期间的占位界面；由 Next.js 的路由加载边界自动使用。
 */
export default function Loading() {
	return (
		<div className="p-12 text-center text-muted-foreground">
			正在加载工作台…
		</div>
	);
}
