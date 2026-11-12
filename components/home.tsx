"use client";
/**
 * 项目首页的客户端交互层。
 * 项目卡片及统计由服务端传入；本组件只管理新建对话框、提交状态和操作后的跳转。
 * 数据写入统一调用经过鉴权与校验的 mutate，不在浏览器中直接访问数据库。
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, ArrowRight, FolderOpen, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
/**
 * 首页卡片使用的轻量数据结构，不含候选人的原文、附件 key 或 AI 分析内容。
 */
type Project = {
	id: string;
	name: string;
	updatedAt: string;
	total: number;
	done: number;
	pending: number;
};
/**
 * 展示项目概览，支持新建、体验示例和删除项目。
 * 新建使用 Dialog 管理焦点与遮罩，删除使用 AlertDialog 显式确认；交互状态不写入数据库。
 */
export function Home({ projects }: { projects: Project[] }) {
	const router = useRouter();
	// 新建窗口由受控状态管理；请求过程中不允许关闭，避免用户误以为提交已被取消。
	const [open, setOpen] = useState(false);
	const [busy, start] = useTransition();
	// 把 Server Action 放入 transition，提交期间统一禁用相关操作；成功后新项目跳转到详情，其余操作刷新统计。
	function run(input: Parameters<typeof mutate>[0]) {
		start(async () => {
			const r = await mutate(input);
			if (!r.ok) {
				toast.error(r.error);
				return;
			}
			if (r.id) router.push(`/projects/${r.id}`);
			else {
				toast.success("已删除项目");
				router.refresh();
			}
		});
	}
	return (
		<main className="mx-auto max-w-[1540px] px-5 py-8 md:px-9">
			<section className="mb-6 flex flex-col justify-between gap-6 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-[#f7f9ff] to-sky-50 p-7 lg:flex-row lg:items-center lg:p-9">
				<div>
					<p className="mb-3 text-[11px] font-bold tracking-[.16em] text-primary">
						RECRUITMENT WORKSPACE
					</p>
					<h1 className="page-title">从 JD 和简历开始，完成一批初筛</h1>
					<p className="mt-3 text-sm text-slate-500">
						上传材料，核对关键证据，交付有理由的推荐名单。
					</p>
				</div>
				<div className="flex flex-wrap gap-3">
					<Button onClick={() => setOpen(true)} disabled={busy}>
						<Plus />
						新建筛选项目
					</Button>
					<Button
						variant="outline"
						onClick={() => run({ type: "demo" })}
						disabled={busy}
					>
						<Sparkles />
						{busy ? "处理中…" : "一键体验示例"}
					</Button>
				</div>
			</section>
			<section className="mb-8 grid gap-4 sm:grid-cols-3">
				{[
					["招聘项目", projects.length, "以岗位筛选任务为单位管理"],
					[
						"待复核候选人",
						projects.reduce((n, p) => n + p.pending, 0),
						"材料可用，等待人工判断",
					],
					[
						"已完成复核",
						projects.reduce((n, p) => n + p.done, 0),
						"保存后可跨设备继续",
					],
				].map(([label, value, description]) => (
					<Card key={label} className="p-5">
						<p className="hint">{label}</p>
						<p className="my-2 text-3xl font-semibold">{value}</p>
						<p className="hint">{description}</p>
					</Card>
				))}
			</section>
			<div className="mb-5">
				<h2 className="section-title">继续已有项目</h2>
				<p className="hint mt-1">所有成员共享此工作台的项目与复核记录</p>
			</div>
			{projects.length ? (
				<section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{projects.map((p) => (
						<Card
							key={p.id}
							className="relative p-5 transition-colors hover:border-blue-300"
						>
							<Link href={`/projects/${p.id}`} className="block">
								<Badge variant="secondary" className="pill">
									{p.total ? "筛选中" : "待导入简历"}
								</Badge>
								<h3 className="mb-2 mt-4 pr-8 font-semibold">{p.name}</h3>
								<p className="hint">
									{p.total} 位候选人 · {p.pending} 位待复核
								</p>
								<Progress
									aria-label="复核进度"
									value={p.total ? (p.done / p.total) * 100 : 0}
									className="my-5 h-1.5 bg-muted"
								/>
								<div className="flex justify-between text-xs text-muted-foreground">
									<span>
										复核进度 {p.done}/{p.total}
									</span>
									<span className="flex items-center gap-1">
										继续项目
										<ArrowRight className="size-3" />
									</span>
								</div>
							</Link>
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										aria-label={`删除 ${p.name}`}
										className="absolute right-3 top-3 text-muted-foreground"
										disabled={busy}
									>
										<Trash2 />
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>删除项目？</AlertDialogTitle>
										<AlertDialogDescription>
											将删除“{p.name}”及其所有材料和复核记录，此操作无法撤销。
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>取消</AlertDialogCancel>
										<AlertDialogAction
											className="bg-destructive text-white hover:bg-destructive/90"
											onClick={() => run({ type: "delete", projectId: p.id })}
										>
											删除项目
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</Card>
					))}
				</section>
			) : (
				<Card className="flex flex-col items-center gap-3 p-16 text-center">
					<FolderOpen className="size-9 text-slate-300" />
					<h3 className="font-semibold">还没有筛选项目</h3>
					<p className="hint">新建一个项目，或从示例体验完整流程。</p>
				</Card>
			)}
			{/* 关闭对话框会卸载表单内容；尚未提交的字段只是临时草稿。 */}
			<Dialog
				open={open}
				onOpenChange={(value) => {
					if (!busy) setOpen(value);
				}}
			>
				<DialogContent
					className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
					showCloseButton={!busy}
				>
					<DialogHeader>
						<DialogTitle>新建筛选项目</DialogTitle>
						<DialogDescription>
							自动生成可编辑的规则草稿，之后可使用 AI 辅助起草。
						</DialogDescription>
					</DialogHeader>
					<form
						className="mt-6 space-y-5"
						onSubmit={(e) => {
							e.preventDefault();
							// 从当前表单读取岗位名与 JD；输入类型只提供开发期约束，服务端仍执行 Zod 校验。
							const f = new FormData(e.currentTarget);
							run({
								type: "create",
								name: String(f.get("name")),
								jd: String(f.get("jd")),
							});
						}}
					>
						<label className="field">
							岗位名称
							<Input
								name="name"
								required
								maxLength={200}
								placeholder="例如：校招产品经理"
								autoFocus
							/>
						</label>
						<label className="field">
							职位描述 JD
							<Textarea
								name="jd"
								maxLength={100000}
								className="min-h-52"
								placeholder="粘贴 JD；创建后也可上传文件"
							/>
						</label>

						<Button type="submit" disabled={busy}>
							{busy ? "创建中…" : "创建项目 →"}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</main>
	);
}
