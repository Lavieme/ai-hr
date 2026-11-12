/**
 * 共享工作台页头。退出按钮直接提交服务端 logout 动作，清除 Cookie 后由服务端重定向。
 */
import Link from "next/link";
import { logout } from "@/app/actions";
import { Button } from "@/components/ui/button";
/**
 * 保持品牌与全项目导航一致；使用 Button 的 asChild 让链接保留原生导航语义。
 */
export function Header() {
	return (
		<header className="border-b bg-white">
			<div className="mx-auto flex min-h-[70px] max-w-[1540px] flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-9">
				<Link href="/" className="flex items-center gap-3 font-bold">
					<span className="grid size-9 place-items-center rounded-xl bg-primary text-white">
						衡
					</span>
					<span className="text-xl">知衡</span>
					<span className="hidden text-xs font-normal text-muted-foreground sm:block">
						校招初筛助手
					</span>
				</Link>
				<div className="flex items-center gap-3">
					<span className="hidden text-xs text-muted-foreground lg:block">
						用简历证据，快速完成一批初筛
					</span>
					<Button asChild variant="outline" size="sm">
						<Link href="/">所有项目</Link>
					</Button>
					<form action={logout}>
						<Button variant="ghost" size="sm">
							退出
						</Button>
					</form>
				</div>
			</div>
		</header>
	);
}
