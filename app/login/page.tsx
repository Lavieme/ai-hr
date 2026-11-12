/**
 * 共享密码登录页的服务端组件。
 * 已登录用户直接回首页；未登录用户通过 Server Action 提交密码，页面同时展示当前访问密码以便体验。
 */
import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { login } from "@/app/actions";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PendingButton } from "@/components/pending-button";
/**
 * 查询参数 error 仅用于显示登录动作返回的配置/密码错误，不作为认证依据。
 * 按项目的公开体验需求，始终展示当前 APP_PASSWORD；未配置时明确提示，不用固定密码兜底。
 */
export default async function Login({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>;
}) {
	if (await isAuthenticated()) redirect("/");
	const { error } = await searchParams;
	return (
		<main className="grid min-h-screen place-items-center px-5">
			<Card className="w-full max-w-md p-9">
				<span className="mb-6 grid size-12 place-items-center rounded-xl bg-primary text-xl font-bold text-white">
					衡
				</span>
				<h1 className="page-title">进入知衡工作台</h1>
				<p className="mt-3 text-sm leading-7 text-muted-foreground">
					从 JD 和简历开始，交付有证据的推荐名单。使用团队共享密码登录。
				</p>
				<form action={login} className="mt-7 space-y-5">
					<label className="field">
						工作台密码
						<Input
							name="password"
							type="password"
							required
							autoComplete="current-password"
							autoFocus
							placeholder="输入共享访问密码"
						/>
					</label>
					<p className="hint">
						访问密码：
						<code className="font-mono text-primary">
							{process.env.APP_PASSWORD || "未配置"}
						</code>
					</p>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error === "config"
								? "服务尚未配置 APP_PASSWORD 和 AUTH_SECRET，请联系部署者。"
								: "密码不正确，请重试。"}
						</p>
					)}
					<PendingButton>进入工作台 →</PendingButton>
				</form>
				<p className="hint mt-6">团队共享项目 · 数据保存于服务器</p>
			</Card>
		</main>
	);
}
