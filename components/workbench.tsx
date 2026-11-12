"use client";
/**
 * 项目工作台的客户端界面，按“准备材料、复核候选人、交付名单”组织主流程。
 * project 是服务端读取的持久化快照；表单编辑值在本地暂存，只有显式保存或导入才写入服务器。
 * 普通写入通过 run 调用 Server Action，文件和 AI 则调用各自的 Route Handler。
 * 展示层的盲筛不会修改原始数据，提交证据时仍使用可在原文中核对的真实片段。
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	ArrowRight,
	Upload,
	FileText,
	Sparkles,
	Plus,
	Trash2,
	Download,
	Check,
	ShieldCheck,
	ClipboardCheck,
} from "lucide-react";
import { toast } from "sonner";
import { mutate, type ActionInput } from "@/app/actions";
import {
	criteriaSchema,
	ruleCriteria,
	mask,
	candidateNo,
	decisionLabels,
	type CriterionInput,
} from "@/lib/domain";
import type {
	WorkProject,
	WorkCandidate,
	TemplateOption,
	AiItem,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
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
/**
 * 当前工作台视图，只影响本地导航；刷新后回到材料页，不代表已保存的业务数据丢失。
 */
type View = "import" | "review" | "recommend" | "standard" | "feedback";
/**
 * 各面板共享的保存入口；可选 success 回调用于清空已提交的输入等界面收尾操作。
 */
type Run = (input: ActionInput, success?: () => void) => void;
/**
 * 材料检查状态的中文文案；ready 只控制能否复核，不代表推荐结论。
 */
const importLabels: Record<string, string> = {
	ready: "可复核",
	duplicate: "重复简历",
	incomplete: "内容不完整",
	failed: "解析失败",
};
/**
 * 标准优先级的展示映射，供 Select、证据卡和历史快照共用。
 */
const priorityLabels: Record<string, string> = {
	must: "必须满足",
	core: "重点考察",
	bonus: "加分项",
};
/**
 * 协调页面导航、全局提交状态和各业务面板，并展示项目统计及重新检查提醒。
 * 不把“生成 AI 线索”和“保存人工结论”合并成同一动作。
 */
export function Workbench({
	project: p,
	templates,
	storageEnabled,
	aiEnabled,
}: {
	project: WorkProject;
	templates: TemplateOption[];
	storageEnabled: boolean;
	aiEnabled: boolean;
}) {
	const router = useRouter();
	const [view, setView] = useState<View>("import");
	const [busy, start] = useTransition();
	// 服务端动作返回成功后刷新 RSC 数据，同时保留本组件的视图等客户端状态。
	// 业务错误用 toast 展示，只有成功写入后才调用 success 回调。
	const run: Run = (input, success) =>
		start(async () => {
			const r = await mutate(input);
			if (!r.ok) {
				toast.error(r.error);
				return;
			}
			toast.success("已保存");
			success?.();
			router.refresh();
		});
	// 待复核只统计材料可用且尚无结论、或需要重新检查的候选人；异常材料先留在材料页处理。
	const ready = p.candidates.filter((c) => c.importStatus === "ready");
	const pending = ready.filter((c) => !c.decision || c.needsReview).length;
	return (
		<main className="mx-auto max-w-[1540px] px-4 py-7 md:px-9">
			<div className="mb-5 text-xs text-muted-foreground">
				<Link href="/">项目</Link>
				<span className="mx-2">/</span>
				{p.name}
			</div>
			<nav
				aria-label="筛选流程"
				className="mb-7 flex flex-wrap overflow-hidden rounded-xl border bg-white"
			>
				{(
					[
						["import", "准备材料"],
						["review", "复核候选人"],
						["recommend", "交付名单"],
					] as const
				).map(([key, label], i) => (
					<button
						key={key}
						aria-current={view === key ? "step" : undefined}
						onClick={() => setView(key)}
						className={`flex flex-1 items-center justify-center gap-2 border-r px-3 py-4 text-sm font-semibold sm:flex-none sm:px-6 ${view === key ? "bg-blue-50 text-primary" : "text-slate-500 hover:bg-muted"}`}
					>
						<span
							className={`grid size-6 place-items-center rounded-full text-xs ${view === key ? "bg-primary text-white" : "bg-muted"}`}
						>
							{i + 1}
						</span>
						{label}
					</button>
				))}
				<div className="flex w-full flex-wrap items-center gap-2 p-3 sm:ml-auto sm:w-auto">
					<Button
						variant={view === "standard" ? "secondary" : "ghost"}
						size="sm"
						onClick={() => setView("standard")}
					>
						筛选依据 · V{p.version}
					</Button>
					<Button
						variant={view === "feedback" ? "secondary" : "ghost"}
						size="sm"
						onClick={() => setView("feedback")}
					>
						经理反馈{p.feedback.length ? ` · ${p.feedback.length}` : ""}
					</Button>
				</div>
			</nav>
			<div className="mb-6 flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="page-title">
						{
							{
								import: "准备本次筛选",
								review: "复核候选人",
								recommend: "交付推荐名单",
								standard: "筛选依据",
								feedback: "反馈与复用",
							}[view]
						}
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						{
							{
								import: "导入岗位 JD 与简历，处理异常材料后开始复核。",
								review: "AI 提供原文线索，最终结论由 HR 人工确认。",
								recommend: "汇总人工推荐、具体依据和待验证问题，交给用人经理。",
								standard: "从 JD 提取初稿，按需调整并与用人经理对齐。",
								feedback: "记录反馈，将材料或标准问题带回筛选流程。",
							}[view]
						}
					</p>
				</div>
				<label className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2.5 text-xs">
					<ShieldCheck className="size-4 text-primary" />
					<Checkbox
						aria-label="盲筛模式"
						checked={p.blind}
						disabled={busy}
						onCheckedChange={(checked) =>
							run({
								type: "project",
								projectId: p.id,
								name: p.name,
								jd: p.jd,
								blind: checked === true,
							})
						}
					/>
					盲筛模式
				</label>
			</div>
			{p.candidates.some((c) => c.needsReview) && (
				<div className="notice mb-5">
					评价卡或材料已变更，{p.candidates.filter((c) => c.needsReview).length}{" "}
					位候选人需要重新检查；原人工结论仍保留。
				</div>
			)}
			{view === "import" && (
				<ImportPanel
					p={p}
					busy={busy}
					run={run}
					storageEnabled={storageEnabled}
					onReview={() => setView("review")}
				/>
			)}
			{view === "standard" && (
				<StandardPanel
					key={p.version}
					p={p}
					templates={templates}
					busy={busy}
					run={run}
					aiEnabled={aiEnabled}
				/>
			)}
			{view === "review" && (
				<ReviewPanel
					p={p}
					busy={busy}
					run={run}
					aiEnabled={aiEnabled}
					onImport={() => setView("import")}
				/>
			)}
			{view === "recommend" && (
				<RecommendPanel p={p} onReview={() => setView("review")} />
			)}
			{view === "feedback" && <FeedbackPanel p={p} busy={busy} run={run} />}
			<footer className="mt-9 flex flex-wrap justify-between gap-3 border-t pt-5 text-xs text-muted-foreground">
				<span>
					{p.name} · {p.candidates.length} 位候选人 · {pending} 位待复核
				</span>
				<span>共享工作台 · 所有更改保存于服务器</span>
			</footer>
		</main>
	);
}
/**
 * JD 与简历共用的单文件/批量上传区域。
 * 每批最多 30 份、逐份请求；单份失败会收集提示后继续后面的文件，最后刷新已入库的材料。
 * JD 提取文字通过 onText 回填草稿，简历则由上传接口直接创建候选人。
 */
function UploadBox({
	p,
	kind,
	enabled,
	onText,
}: {
	p: WorkProject;
	kind: "jd" | "resume";
	enabled: boolean;
	onText?: (text: string) => void;
}) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("");
	// 接收普通数组而不是 FileList：文件选择器清空后 FileList 会变化，不能用它计算异步进度总数。
	async function upload(files: File[]) {
		if (!files?.length) return;
		if (files.length > 30) {
			toast.error("每批最多 30 个文件");
			return;
		}
		setBusy(true);
		let success = 0;
		// 成功数表示文件已保存；解析警告不等于上传失败，材料是否可复核由服务端返回的候选人状态决定。
		const warnings: string[] = [];
		try {
			// 串行处理控制内存和请求数量；盲筛时上传进度不显示可能含有姓名的文件名。
			for (const [i, file] of files.entries()) {
				setStatus(
					`正在上传 ${i + 1}/${files.length}：${kind === "resume" && p.blind ? "候选人材料" : file.name}`,
				);
				try {
					if (file.size > 15 * 1024 * 1024) throw new Error("文件超过 15 MB");
					const form = new FormData();
					form.set("projectId", p.id);
					form.set("kind", kind);
					form.set("file", file);
					const r = await fetch("/api/upload", { method: "POST", body: form });
					const data = await r.json();
					if (!r.ok) throw new Error(data.error);
					// 只更新 JD 编辑框，不自动提交岗位修改；由用户核对后再点击保存岗位材料。
					if (kind === "jd" && data.text) onText?.(data.text);
					if (data.warning) warnings.push(data.warning);
					success++;
				} catch (e) {
					warnings.push(e instanceof Error ? e.message : "上传失败");
				}
			}
		} finally {
			setBusy(false);
			setStatus(
				`已完成 ${success}/${files.length} 份材料${warnings.length ? "；" + warnings.join("；") : ""}`,
			);
			router.refresh();
		}
	}
	return (
		<div className="rounded-xl border border-dashed border-blue-200 bg-blue-50/30 p-4">
			<div className="mb-3 flex items-center gap-2 text-sm font-medium">
				<Upload className="size-4 text-primary" />
				{kind === "jd" ? "导入 JD 文件" : "批量导入简历"}
			</div>
			<Input
				aria-label={kind === "jd" ? "上传 JD" : "上传简历"}
				type="file"
				accept=".txt,.md,.docx,.pdf"
				multiple={kind === "resume"}
				disabled={!enabled || busy}
				onChange={(e) => {
					// 先复制文件列表，再清空 input，既固定了本批次文件，也允许再次选择同一个文件。
					void upload(Array.from(e.target.files ?? []));
					e.target.value = "";
				}}
			/>
			<p className="hint mt-2">
				TXT / Markdown / DOCX / PDF · 单文件 ≤15 MB · PDF ≤12 页
			</p>
			{!enabled && (
				<p className="mt-2 text-xs text-amber-700">
					对象存储未配置，请先使用文本粘贴。
				</p>
			)}
			{status && (
				<p role="status" className="mt-2 text-xs leading-6 text-primary">
					{status}
				</p>
			)}
		</div>
	);
}
/**
 * 材料准备面板：维护岗位名/JD 草稿、批量粘贴内容，以及当前打开的候选人修正表单。
 * 岗位保存、文本导入和文件上传是独立操作，不会因切换页面自动提交所有草稿。
 */
function ImportPanel({
	p,
	busy,
	run,
	storageEnabled,
	onReview,
}: {
	p: WorkProject;
	busy: boolean;
	run: Run;
	storageEnabled: boolean;
	onReview: () => void;
}) {
	// 从当前项目快照初始化编辑值；上传 JD 时更新本地 jd，已保存的 p.jd 仍以服务端结果为准。
	const [name, setName] = useState(p.name);
	const [jd, setJd] = useState(p.jd);
	const [paste, setPaste] = useState("");
	const [editing, setEditing] = useState<string | null>(null);
	return (
		<div className="space-y-6">
			<div className="grid gap-5 lg:grid-cols-2">
				<Card className="space-y-5 p-6">
					<h2 className="section-title">岗位材料</h2>
					<label className="field">
						岗位名称
						<Input
							value={name}
							maxLength={200}
							onChange={(e) => setName(e.target.value)}
						/>
					</label>
					<label className="field">
						职位描述 JD
						<Textarea
							value={jd}
							maxLength={100000}
							onChange={(e) => setJd(e.target.value)}
							className="min-h-48"
						/>
					</label>
					<UploadBox p={p} kind="jd" enabled={storageEnabled} onText={setJd} />
					<Button
						disabled={busy || !name.trim()}
						onClick={() =>
							run({
								type: "project",
								projectId: p.id,
								name,
								jd,
								blind: p.blind,
							})
						}
					>
						保存岗位材料
					</Button>
					<p className="hint">
						JD 修改后，进入“筛选依据”重新生成或调整评价卡。
					</p>
					{p.attachments
						.filter((a) => a.kind === "jd")
						.map((a) => (
							<a
								key={a.id}
								href={`/api/attachments/${a.id}`}
								className="flex items-center gap-2 text-xs text-primary"
							>
								<FileText className="size-3" />
								{a.name} · 下载原件
							</a>
						))}
				</Card>
				<Card className="space-y-5 p-6">
					<h2 className="section-title">候选人简历</h2>
					<UploadBox p={p} kind="resume" enabled={storageEnabled} />
					<label className="field">
						或粘贴简历文本
						<Textarea
							value={paste}
							onChange={(e) => setPaste(e.target.value)}
							maxLength={100000}
							className="min-h-48"
							placeholder={
								"第一行填写姓名，其后粘贴简历正文。\n多份简历用单独一行 --- 分隔。"
							}
						/>
					</label>
					<div className="flex flex-wrap gap-3">
						<Button
							disabled={busy || !paste.trim()}
							onClick={() =>
								run({ type: "paste", projectId: p.id, content: paste }, () =>
									setPaste(""),
								)
							}
						>
							<Plus />
							导入文本
						</Button>
						<Button variant="outline" onClick={onReview}>
							开始复核
							<ArrowRight />
						</Button>
					</div>
				</Card>
			</div>
			<Card className="overflow-hidden">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
					<h2 className="section-title">
						材料检查{" "}
						<span className="ml-2 text-sm font-normal text-muted-foreground">
							{p.candidates.length} 位候选人
						</span>
					</h2>
					<span className="hint">异常材料核对后可手动确认可用</span>
				</div>
				{!p.candidates.length ? (
					<p className="hint p-12 text-center">
						导入第一份简历，开始本次筛选。
					</p>
				) : (
					<div className="divide-y">
						{p.candidates.map((c) => (
							<div key={c.id} className="p-5">
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div>
										<span className="mr-3 font-medium">
											{p.blind ? candidateNo(c.number) : c.name}
										</span>
										<Badge
											variant="secondary"
											className={`pill ${c.importStatus === "ready" ? "pill-green" : "pill-amber"}`}
										>
											{importLabels[c.importStatus]}
										</Badge>
										{c.decision && (
											<span className="ml-2 text-xs text-muted-foreground">
												{decisionLabels[c.decision]}
											</span>
										)}
										<p className="hint mt-2">
											{p.blind ? "简历材料" : c.source} · {c.content.length} 字{" "}
											{c.importNote && `· ${c.importNote}`}
										</p>
									</div>
									<div className="flex gap-2">
										{!p.blind &&
											c.attachments.map((a) => (
												<Button key={a.id} asChild size="sm" variant="outline">
													<a href={`/api/attachments/${a.id}`}>原件</a>
												</Button>
											))}
										<Button
											size="sm"
											variant="outline"
											onClick={() => setEditing(editing === c.id ? null : c.id)}
										>
											{p.blind ? "核对文本" : "修正材料"}
										</Button>
									</div>
								</div>
								{editing === c.id && (
									<CandidateEditor
										key={c.updatedAt + p.blind}
										c={c}
										blind={p.blind}
										run={run}
										busy={busy}
									/>
								)}
							</div>
						))}
					</div>
				)}
			</Card>
		</div>
	);
}
/**
 * 候选人材料的核对与修正入口。
 * 盲筛时只展示脱敏文本，禁止编辑原文；关闭盲筛后可修正姓名或正文。
 * “保存修正”重新计算材料状态，“确认材料可用”是 HR 对异常材料的主动放行。
 */
function CandidateEditor({
	c,
	blind,
	run,
	busy,
}: {
	c: WorkCandidate;
	blind: boolean;
	run: Run;
	busy: boolean;
}) {
	const [name, setName] = useState(c.name);
	// 原文编辑草稿保留未脱敏内容，显示时才根据 blind 决定是否执行 mask。
	const [content, setContent] = useState(c.content);
	return (
		<div className="mt-4 space-y-3 rounded-lg bg-muted/50 p-4">
			{blind ? (
				<>
					<p className="hint">
						盲筛中仅展示脱敏文本；如需修正姓名或原文，请主动关闭盲筛。
					</p>
					<pre className="max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-7">
						{mask(content, name, true) || "暂无可用文本"}
					</pre>
				</>
			) : (
				<>
					<label className="field">
						姓名
						<Input
							value={name}
							maxLength={200}
							onChange={(e) => setName(e.target.value)}
						/>
					</label>
					<label className="field">
						简历原文
						<Textarea
							className="min-h-64"
							value={content}
							maxLength={100000}
							onChange={(e) => setContent(e.target.value)}
						/>
					</label>
				</>
			)}
			<div className="flex flex-wrap gap-3">
				{!blind && (
					<Button
						size="sm"
						variant="outline"
						disabled={busy || !name.trim()}
						onClick={() =>
							run({
								type: "candidate",
								id: c.id,
								name,
								content,
								confirm: false,
							})
						}
					>
						保存修正
					</Button>
				)}
				<Button
					size="sm"
					disabled={busy || !content.trim()}
					onClick={() =>
						run({ type: "candidate", id: c.id, name, content, confirm: true })
					}
				>
					<Check />
					确认材料可用
				</Button>
			</div>
		</div>
	);
}
/**
 * 评价卡面板，支持规则/AI 起草、逐项编辑、经理确认、历史查看和模板复用。
 * criteria 是尚未保存的草稿；p.criteria 是数据库里已生效的标准，保存模板使用后者。
 * 父组件用 p.version 作为 key，新版本保存成功后会用服务端数据重建本面板的本地状态。
 */
function StandardPanel({
	p,
	templates,
	busy,
	run,
	aiEnabled,
}: {
	p: WorkProject;
	templates: TemplateOption[];
	busy: boolean;
	run: Run;
	aiEnabled: boolean;
}) {
	// 编辑已有条目时保留 id；重新生成的规则/AI 草稿不携带旧 id，保存时由服务端创建新标准。
	const [criteria, setCriteria] = useState<CriterionInput[]>(
		p.criteria.map((c) => ({
			id: c.id,
			title: c.title,
			evidence: c.evidence,
			importance: c.importance as CriterionInput["importance"],
		})),
	);
	const [aiBusy, setAiBusy] = useState(false);
	// 单独标记当前表单来源，提醒用户生成成功不等于评价卡已经正式修订。
	const [draftSource, setDraftSource] = useState("");
	const [manager, setManager] = useState("用人经理");
	const [template, setTemplate] = useState("");
	const [templateName, setTemplateName] = useState(p.name);
	// 这里只请求并展示 AI 草稿；失败不调用 setCriteria，保留用户原有的编辑内容。
	async function aiDraft() {
		setAiBusy(true);
		try {
			const r = await fetch(`/api/projects/${p.id}/ai`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ kind: "criteria" }),
			});
			const d = await r.json();
			if (!r.ok) throw new Error(d.error);
			setCriteria(d.criteria);
			setDraftSource("AI 草稿，须核对后保存");
			toast.success("已生成草稿，核对后点击保存评价卡");
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "AI 调用失败");
		} finally {
			setAiBusy(false);
		}
	}
	// 按当前表单顺序只替换一项，创建新数组以触发 React 更新，不原地修改服务端传入的项目对象。
	function update(i: number, data: Partial<CriterionInput>) {
		setCriteria(
			criteria.map((c, index) => (index === i ? { ...c, ...data } : c)),
		);
	}
	return (
		<div className="space-y-5">
			<div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
				<Card className="space-y-4 p-6">
					<h2 className="section-title">评价卡 V{p.version}</h2>
					<p className="hint whitespace-pre-wrap">
						{p.jd || "尚未填写 JD，请返回准备材料补充。"}
					</p>
					<div className="flex flex-wrap gap-3">
						<Button
							variant="outline"
							disabled={busy || aiBusy}
							onClick={() => {
								setCriteria(ruleCriteria(p.jd));
								setDraftSource("规则草稿，须核对后保存");
							}}
						>
							规则生成草稿
						</Button>
						<Button
							disabled={busy || aiBusy || !aiEnabled}
							onClick={() => void aiDraft()}
						>
							<Sparkles />
							{aiBusy ? "生成中…" : "AI 起草评价卡"}
						</Button>
						<Button asChild variant="outline">
							<a href={`/api/projects/${p.id}/export?kind=card`}>
								<Download />
								导出评价卡
							</a>
						</Button>
					</div>
					<p className="hint">
						{aiEnabled
							? "AI 仅接收当前 JD，草稿不会自动覆盖已保存评价卡。"
							: "AI 未配置，规则草稿和人工编辑仍可正常使用。"}
					</p>
				</Card>
				<Card className="space-y-4 p-6">
					<h2 className="section-title">与用人经理对齐</h2>
					{p.confirmedAt ? (
						<p className="text-sm text-emerald-700">
							已记录确认 · {p.confirmedBy} ·{" "}
							{new Date(p.confirmedAt).toLocaleDateString("zh-CN")}
						</p>
					) : (
						<p className="hint">
							无需等待确认即可开始筛选；评价卡修订后需要重新记录确认。
						</p>
					)}
					<label className="field">
						确认人
						<Input
							value={manager}
							maxLength={200}
							onChange={(e) => setManager(e.target.value)}
						/>
					</label>
					<Button
						variant="outline"
						disabled={busy || !manager.trim()}
						onClick={() =>
							run({
								type: "confirm",
								projectId: p.id,
								name: manager,
								version: p.version,
							})
						}
					>
						<ClipboardCheck />
						记录当前版本确认
					</Button>
					{/* 历史快照先按共享 Schema 解析，再按标准与证据展示；不把数据库 JSON 直接展示给使用者。 */}
					<Accordion type="single" collapsible>
						<AccordionItem value="history">
							<AccordionTrigger className="text-xs text-primary">
								查看历史版本（{p.versions.length}）
							</AccordionTrigger>
							<AccordionContent>
								<Accordion type="single" collapsible>
									{p.versions.map((v) => (
										<AccordionItem key={v.id} value={v.id}>
											<AccordionTrigger className="text-xs">
												V{v.version} ·{" "}
												{new Date(v.createdAt).toLocaleString("zh-CN")}
											</AccordionTrigger>
											<AccordionContent className="space-y-3">
												{criteriaSchema
													.safeParse(v.snapshot)
													.data?.map((item, index) => (
														<div
															key={index}
															className="rounded-lg bg-muted/50 p-3"
														>
															<p className="text-xs font-medium">
																{item.title}
															</p>
															<p className="hint mt-1">
																{priorityLabels[item.importance]} ·{" "}
																{item.evidence}
															</p>
														</div>
													))}
											</AccordionContent>
										</AccordionItem>
									))}
								</Accordion>
							</AccordionContent>
						</AccordionItem>
					</Accordion>
				</Card>
			</div>
			<Card className="space-y-4 p-6">
				<div className="flex flex-wrap justify-between gap-3">
					<h2 className="section-title">
						逐项评价标准{" "}
						<span className="ml-2 text-xs font-normal text-primary">
							{draftSource}
						</span>
					</h2>
					<Button
						size="sm"
						variant="outline"
						disabled={criteria.length >= 30 || busy}
						onClick={() =>
							setCriteria([
								...criteria,
								{
									title: "",
									evidence: "具体描述个人行动、过程或结果",
									importance: "core",
								},
							])
						}
					>
						<Plus />
						添加标准
					</Button>
				</div>
				{criteria.map((c, i) => (
					<div
						key={c.id || `new-${i}`}
						className="grid gap-4 rounded-xl border p-4 lg:grid-cols-[1fr_1.2fr_150px_40px]"
					>
						<label className="field">
							标准 {i + 1}
							<Input
								value={c.title}
								maxLength={500}
								onChange={(e) => update(i, { title: e.target.value })}
							/>
						</label>
						<label className="field">
							应查找的证据
							<Input
								value={c.evidence}
								maxLength={2000}
								onChange={(e) => update(i, { evidence: e.target.value })}
							/>
						</label>
						<label className="field">
							优先级
							<Select
								value={c.importance}
								onValueChange={(value) =>
									update(i, {
										importance: value as CriterionInput["importance"],
									})
								}
							>
								<SelectTrigger
									aria-label={`标准 ${i + 1} 优先级`}
									className="w-full"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{Object.entries(priorityLabels).map(([value, label]) => (
										<SelectItem key={value} value={value}>
											{label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</label>
						<Button
							variant="ghost"
							size="icon"
							className="self-end text-muted-foreground"
							aria-label={`删除标准 ${i + 1}`}
							disabled={criteria.length === 1}
							onClick={() =>
								setCriteria(criteria.filter((_, index) => index !== i))
							}
						>
							<Trash2 />
						</Button>
					</div>
				))}
				<div className="flex flex-wrap items-center gap-4">
					<Button
						disabled={busy || aiBusy || criteria.some((c) => !c.title.trim())}
						onClick={() =>
							run({
								type: "criteria",
								projectId: p.id,
								criteria,
								version: p.version,
							})
						}
					>
						保存评价卡，创建新版本
					</Button>
					<p className="hint">
						修订会提示重新检查已有结论，不会自动改写人工判断。
					</p>
				</div>
			</Card>
			<Card className="grid gap-6 p-6 lg:grid-cols-2">
				<div className="space-y-3">
					<h2 className="section-title">保存当前评价卡为模板</h2>
					<Input
						aria-label="模板名称"
						value={templateName}
						maxLength={200}
						onChange={(e) => setTemplateName(e.target.value)}
					/>
					<Button
						variant="outline"
						disabled={busy || !templateName.trim()}
						onClick={() =>
							run({
								type: "template-save",
								projectId: p.id,
								name: templateName,
							})
						}
					>
						保存已生效版本为模板
					</Button>
				</div>
				<div className="space-y-3">
					<h2 className="section-title">使用已有模板</h2>
					<Select
						value={template}
						onValueChange={setTemplate}
						disabled={busy || !templates.length}
					>
						<SelectTrigger aria-label="选择模板" className="w-full">
							<SelectValue
								placeholder={templates.length ? "选择模板" : "暂无可用模板"}
							/>
						</SelectTrigger>
						<SelectContent>
							{templates.map((t) => (
								<SelectItem key={t.id} value={t.id}>
									{t.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button variant="outline" disabled={busy || !template}>
								应用模板并创建新版本
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>应用评价卡模板？</AlertDialogTitle>
								<AlertDialogDescription>
									当前评价卡将替换为所选模板并创建新版本，已有复核结论会标记为需要重新检查。
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>取消</AlertDialogCancel>
								<AlertDialogAction
									onClick={() =>
										run({
											type: "template-use",
											projectId: p.id,
											templateId: template,
											version: p.version,
										})
									}
								>
									应用模板
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</Card>
		</div>
	);
}
/**
 * 组织候选人队列：只允许材料 ready 的记录进入复核，支持待复核、全部、已完成和待补充筛选。
 * 保存结论后候选人可能离开当前队列，因此选中记录不存在时自动回退到队列第一位。
 */
function ReviewPanel({
	p,
	busy,
	run,
	aiEnabled,
	onImport,
}: {
	p: WorkProject;
	busy: boolean;
	run: Run;
	aiEnabled: boolean;
	onImport: () => void;
}) {
	const [filter, setFilter] = useState("pending");
	// 保存固定候选人 id，而非数组位置，避免筛选或导入改变顺序后选错人。
	const [selected, setSelected] = useState("");
	const usable = p.candidates.filter((c) => c.importStatus === "ready");
	const queue = usable.filter(
		(c) =>
			filter === "all" ||
			(filter === "pending"
				? !c.decision || c.needsReview
				: filter === "done"
					? !!c.decision && !c.needsReview
					: c.decision === "more"),
	);
	const c = queue.find((c) => c.id === selected) || queue[0];
	return (
		<div className="grid items-start gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
			<Card className="overflow-hidden lg:sticky lg:top-5">
				<div className="space-y-3 border-b p-4">
					<h2 className="section-title">候选人队列</h2>
					<Select value={filter} onValueChange={setFilter}>
						<SelectTrigger aria-label="队列筛选" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="pending">待复核</SelectItem>
							<SelectItem value="all">全部可复核</SelectItem>
							<SelectItem value="done">已完成</SelectItem>
							<SelectItem value="more">待补充信息</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="max-h-[65vh] overflow-auto">
					{queue.map((item) => (
						<button
							key={item.id}
							onClick={() => setSelected(item.id)}
							className={`block w-full border-b p-4 text-left hover:bg-muted ${c?.id === item.id ? "border-l-2 border-l-primary bg-blue-50/60" : ""}`}
						>
							<p className="text-sm font-semibold">
								{p.blind ? candidateNo(item.number) : item.name}
							</p>
							<p className="hint mt-2">
								{item.needsReview
									? "需要重新检查"
									: item.decision
										? decisionLabels[item.decision]
										: "等待人工复核"}
							</p>
						</button>
					))}
					{!queue.length && <p className="hint p-5">当前队列没有候选人。</p>}
				</div>
				<div className="p-4">
					<Button
						className="w-full"
						variant="outline"
						size="sm"
						onClick={onImport}
					>
						返回材料检查
					</Button>
				</div>
			</Card>
			{/* 候选人、评价卡版本或盲筛上下文变化时重建复核草稿；单纯 AI 结果刷新不使用 updatedAt 强制重建，以免丢失未保存的人工输入。 */}
			{c ? (
				<ReviewDetail
					key={c.id + p.version + p.blind}
					p={p}
					c={c}
					busy={busy}
					run={run}
					aiEnabled={aiEnabled}
				/>
			) : (
				<Card className="space-y-4 p-16 text-center">
					<Check className="mx-auto size-8 text-emerald-600" />
					<h2 className="section-title">当前队列已处理完毕</h2>
					<p className="hint">切换队列查看已有结论，或导入更多简历。</p>
				</Card>
			)}
		</div>
	);
}
/**
 * 单个候选人的复核工作区：左侧展示原文，右侧逐项展示标准、AI 线索和人工判断。
 * judgments 与 reason 是人工草稿，AI 引用只有在主动选取后才进入 quote，且不会自动把状态改为已确认。
 * 最终点击结论按钮时，把整份人工草稿和当前评价卡版本一起交给服务端验证、保存。
 */
function ReviewDetail({
	p,
	c,
	busy,
	run,
	aiEnabled,
}: {
	p: WorkProject;
	c: WorkCandidate;
	busy: boolean;
	run: Run;
	aiEnabled: boolean;
}) {
	const router = useRouter();
	const [aiBusy, setAiBusy] = useState(false);
	// focus 保存原文片段，仅用于给匹配的原文段落添加高亮，不修改正文。
	const [focus, setFocus] = useState("");
	const [reason, setReason] = useState(c.reason);
	// 按当前标准补齐表单项；没有已保存判断的标准从 unclear 开始，而不是把 AI 线索视为人工证据。
	const [judgments, setJudgments] = useState(
		p.criteria.map((cr) => {
			const j = c.judgments.find((j) => j.criterionId === cr.id);
			return {
				criterionId: cr.id,
				status: j?.status || "unclear",
				quote: j?.quote || "",
				note: j?.note || "",
				followup: j?.followup || "",
			};
		}),
	);
	// 仅显示生成时标准版本与当前版本一致的 AI 结果；返回结构已在服务端校验过。
	const ai = (
		c.aiVersion === p.version &&
		c.aiResult &&
		typeof c.aiResult === "object" &&
		"items" in c.aiResult
			? c.aiResult.items
			: []
	) as AiItem[];
	// 按段落生成原文选项，空行不参与下拉；界面脱敏与提交原文分开处理。
	const lines = c.content
		.split(/\n/)
		.map((s) => s.trim())
		.filter(Boolean);
	// 所有候选人相关展示经过同一个脱敏函数；原始 quote 值仍保留，供服务端进行逐字核对。
	const display = (s: string) => mask(s, c.name, p.blind);
	// 用标准 id 更新人工草稿，标准顺序变化时不会把备注和引用写到另一项标准上。
	function update(id: string, data: Partial<(typeof judgments)[number]>) {
		setJudgments(
			judgments.map((j) => (j.criterionId === id ? { ...j, ...data } : j)),
		);
	}
	// 触发服务端生成并持久化 AI 线索，完成后只刷新项目数据；不自动提交人工复核表单。
	async function extract() {
		setAiBusy(true);
		try {
			const r = await fetch(`/api/projects/${p.id}/ai`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ kind: "evidence", candidateId: c.id }),
			});
			const d = await r.json();
			if (!r.ok) throw new Error(d.error);
			toast.success("已提取原文线索，请人工核对");
			router.refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "AI 调用失败");
		} finally {
			setAiBusy(false);
		}
	}
	// 三个结论按钮共用此入口，当前评价卡版本与整组人工判断必须一并提交。
	function save(decision: "interview" | "more" | "hold") {
		run({
			type: "review",
			candidateId: c.id,
			version: p.version,
			decision,
			reason,
			judgments: judgments.map((j) => ({
				...j,
				status: j.status as "evidence" | "insufficient" | "unclear",
			})),
		});
	}
	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-xl font-bold">
						{p.blind ? candidateNo(c.number) : c.name}
					</h2>
					<p className="hint mt-1">
						{candidateNo(c.number)} · 评价卡 V{p.version}
						{c.decision ? ` · ${decisionLabels[c.decision]}` : ""}
					</p>
				</div>
				<Button
					disabled={busy || aiBusy || !aiEnabled}
					onClick={() => void extract()}
				>
					<Sparkles />
					{aiBusy ? "提取中…" : "AI 提取逐项证据"}
				</Button>
			</div>
			{!aiEnabled && (
				<p className="hint">AI 未配置，可直接从原文选择证据并完成人工复核。</p>
			)}
			<div className="grid items-start gap-5 xl:grid-cols-[1fr_1.15fr]">
				<Card className="overflow-hidden xl:sticky xl:top-5">
					<div className="flex justify-between border-b p-4">
						<h3 className="font-semibold">简历原文</h3>
						<Badge variant="secondary" className="pill">
							{p.blind ? "已脱敏" : "原始文本"}
						</Badge>
					</div>
					<div className="max-h-[72vh] overflow-auto p-5 text-sm leading-8">
						{lines.map((line, i) => (
							<p
								key={i}
								className={`mb-2 whitespace-pre-wrap rounded px-2 ${focus && line.includes(focus) ? "bg-amber-100" : ""}`}
							>
								{display(line)}
							</p>
						))}
					</div>
				</Card>
				<div className="space-y-4">
					{p.criteria.map((cr) => {
						const j = judgments.find((j) => j.criterionId === cr.id)!;
						const suggestion = ai?.find((a) => a.criterionId === cr.id);
						return (
							<Card key={cr.id} className="space-y-4 p-5">
								<div>
									<Badge variant="secondary" className="pill mb-2">
										{priorityLabels[cr.importance]}
									</Badge>
									<h3 className="text-sm font-semibold leading-6">
										{cr.title}
									</h3>
									<p className="hint mt-2">{cr.evidence}</p>
								</div>
								{suggestion && (
									<div className="space-y-2 rounded-lg bg-blue-50/70 p-3">
										<p className="text-xs font-semibold text-primary">
											AI 建议 · 尚未人工确认
										</p>
										{suggestion.quotes.length ? (
											suggestion.quotes.map((quote, i) => (
												<div key={i} className="space-y-2">
													<p className="text-xs leading-6">
														“{display(quote)}”
													</p>
													<div className="flex gap-2">
														<Button
															size="sm"
															variant="outline"
															onClick={() => setFocus(quote)}
														>
															定位原文
														</Button>
														<Button
															size="sm"
															variant="secondary"
															onClick={() => {
																update(cr.id, {
																	quote,
																	// 用户已填写追问时保留原值；只有为空时才带入 AI 建议，status 仍需 HR 单独确认。
																	followup: j.followup || suggestion.question,
																});
																setFocus(quote);
															}}
														>
															选为待核对证据
														</Button>
													</div>
												</div>
											))
										) : (
											<p className="hint">未找到直接证据</p>
										)}
										{suggestion.missing && (
											<p className="hint">
												缺少信息：{display(suggestion.missing)}
											</p>
										)}
										{suggestion.question && (
											<p className="hint">
												建议追问：{display(suggestion.question)}
											</p>
										)}
									</div>
								)}
								<label className="field">
									从原文选择证据
									<Select
										value={
											lines.includes(j.quote)
												? String(lines.indexOf(j.quote))
												: ""
										}
										onValueChange={(value) => {
											// Select 使用段落索引作为选项值，展示文本可脱敏；选中后回取真实原文，避免把占位符存成证据。
											// clear 是显式清除选项，不能用空字符串作为 Radix SelectItem 的 value。
											const quote =
												value === "clear" ? "" : lines[Number(value)];
											update(cr.id, { quote });
											setFocus(quote);
										}}
									>
										<SelectTrigger
											aria-label={`${cr.title}：从原文选择证据`}
											className="w-full min-w-0"
										>
											<SelectValue placeholder="选择原文段落" />
										</SelectTrigger>
										<SelectContent
											position="popper"
											className="max-w-[min(36rem,calc(100vw-2rem))]"
										>
											<SelectItem value="clear">清除所选证据</SelectItem>
											{lines.map((line, i) => (
												<SelectItem
													key={i}
													value={String(i)}
													textValue={display(line)}
													className="whitespace-normal break-words"
												>
													{display(line)}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</label>
								{p.blind ? (
									<div className="rounded-lg border bg-muted/30 p-3 text-xs leading-6">
										{display(j.quote) || "尚未选择证据"}
									</div>
								) : (
									<label className="field">
										引用原文
										<Textarea
											value={j.quote}
											onChange={(e) => update(cr.id, { quote: e.target.value })}
											placeholder="可粘贴简历中的逐字原文片段"
											maxLength={10000}
										/>
									</label>
								)}
								<label className="field">
									人工判断
									<Select
										value={j.status}
										onValueChange={(value) => update(cr.id, { status: value })}
									>
										<SelectTrigger
											aria-label={`${cr.title}：人工判断`}
											className="w-full"
										>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="unclear">尚未确认</SelectItem>
											<SelectItem value="evidence">
												已核对，存在相关证据
											</SelectItem>
											<SelectItem value="insufficient">
												证据不足，需进一步核实
											</SelectItem>
										</SelectContent>
									</Select>
								</label>
								<label className="field">
									复核备注
									<Input
										value={display(j.note)}
										onChange={(e) => update(cr.id, { note: e.target.value })}
										maxLength={2000}
									/>
								</label>
								<label className="field">
									待核实问题
									<Input
										value={display(j.followup)}
										onChange={(e) =>
											update(cr.id, { followup: e.target.value })
										}
										maxLength={2000}
									/>
								</label>
							</Card>
						);
					})}
				</div>
			</div>
			<Card className="space-y-4 p-5">
				<label className="field">
					本次复核依据与结论说明
					<Textarea
						value={display(reason)}
						onChange={(e) => setReason(e.target.value)}
						maxLength={5000}
						placeholder="记录个人贡献、相关经历和需要进一步核实的信息"
					/>
				</label>
				<p className="hint">
					推荐前请至少确认一项原文证据，或填写具体推荐依据（至少 5
					字）。以下按钮会保存逐项复核与最终人工结论。
				</p>
				<div className="flex flex-wrap gap-3">
					<Button disabled={busy || aiBusy} onClick={() => save("interview")}>
						建议进入面试
					</Button>
					<Button
						variant="outline"
						disabled={busy || aiBusy}
						onClick={() => save("more")}
					>
						待补充信息
					</Button>
					<Button
						variant="outline"
						disabled={busy || aiBusy}
						onClick={() => save("hold")}
					>
						暂不推进
					</Button>
				</div>
			</Card>
		</div>
	);
}
/**
 * 汇总人工 interview 结论；AI 线索不会让候选人自动进入此列表。
 * 保留但标记需要重新检查的旧结论，并复用后端导出入口交付 CSV 或摘要。
 */
function RecommendPanel({
	p,
	onReview,
}: {
	p: WorkProject;
	onReview: () => void;
}) {
	const list = p.candidates.filter((c) => c.decision === "interview");
	// 自由文本可能提及同项目其他候选人，脱敏时依次替换所有已知姓名。
	const sanitize = (s: string) =>
		p.candidates.reduce((text, c) => mask(text, c.name, p.blind), s);
	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-sm">
					人工推荐 <b className="text-primary">{list.length}</b> 人
				</p>
				<div className="flex flex-wrap gap-3">
					<Button variant="outline" asChild>
						<a href={`/api/projects/${p.id}/export?kind=csv`}>
							<Download />
							导出名单 CSV
						</a>
					</Button>
					<Button variant="outline" asChild>
						<a href={`/api/projects/${p.id}/export?kind=summary`}>
							<Download />
							导出交付摘要
						</a>
					</Button>
				</div>
			</div>
			{!list.length ? (
				<Card className="space-y-4 p-14 text-center">
					<h2 className="section-title">暂时没有人工推荐的候选人</h2>
					<p className="hint">
						完成复核并选择“建议进入面试”后，候选人会出现在此处。
					</p>
					<Button variant="outline" onClick={onReview}>
						前往复核
					</Button>
				</Card>
			) : (
				list.map((c) => (
					<Card key={c.id} className="space-y-4 p-6">
						<div className="flex flex-wrap justify-between gap-3">
							<h2 className="section-title">
								{p.blind ? candidateNo(c.number) : c.name}
							</h2>
							<Badge
								variant="secondary"
								className={`pill ${c.needsReview ? "pill-amber" : "pill-green"}`}
							>
								{c.needsReview ? "需要重新检查" : "HR 已人工推荐"}
							</Badge>
						</div>
						<p className="text-sm leading-7">
							{sanitize(
								c.reason ||
									c.judgments
										.filter((j) => j.status === "evidence")
										.map((j) => j.quote)
										.join("；"),
							)}
						</p>
						{c.judgments
							.filter((j) => j.status === "evidence")
							.map((j) => (
								<blockquote
									key={j.id}
									className="border-l-2 border-blue-200 pl-4 text-xs leading-7 text-slate-500"
								>
									{sanitize(j.quote)}
								</blockquote>
							))}
						<div className="rounded-lg bg-muted/60 p-4">
							<h3 className="mb-2 text-xs font-semibold">待核实问题</h3>
							<p className="whitespace-pre-wrap text-xs leading-7">
								{sanitize(
									c.judgments
										.map((j) => j.followup)
										.filter(Boolean)
										.join("\n"),
								) || "暂无记录"}
							</p>
						</div>
					</Card>
				))
			)}
		</div>
	);
}
/**
 * 记录反馈人、反馈类型与具体意见；提交成功后清空内容，其他字段保持便于连续记录。
 * 反馈不会自动修订评价卡或改写人工结论，需要使用者回到对应面板处理。
 */
function FeedbackPanel({
	p,
	busy,
	run,
}: {
	p: WorkProject;
	busy: boolean;
	run: Run;
}) {
	const [author, setAuthor] = useState("用人经理");
	const [category, setCategory] = useState<
		"extract" | "evidence" | "standard" | "change"
	>("evidence");
	const [content, setContent] = useState("");
	// 类型标识与数据库保持一致，Select 显示中文；反馈正文与反馈人展示同样遵守盲筛规则。
	const labels = {
		extract: "信息提取错误",
		evidence: "证据不足",
		standard: "标准理解分歧",
		change: "岗位要求变化",
	};
	const sanitize = (s: string) =>
		p.candidates.reduce((text, c) => mask(text, c.name, p.blind), s);
	return (
		<div className="grid items-start gap-5 lg:grid-cols-2">
			<Card className="space-y-5 p-6">
				<h2 className="section-title">记录经理反馈</h2>
				<label className="field">
					反馈人
					<Input
						value={author}
						maxLength={200}
						onChange={(e) => setAuthor(e.target.value)}
					/>
				</label>
				<label className="field">
					反馈类型
					<Select
						value={category}
						onValueChange={(value) => setCategory(value as typeof category)}
					>
						<SelectTrigger aria-label="反馈类型" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{Object.entries(labels).map(([value, label]) => (
								<SelectItem key={value} value={value}>
									{label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</label>
				<label className="field">
					反馈内容
					<Textarea
						value={content}
						maxLength={5000}
						className="min-h-48"
						onChange={(e) => setContent(e.target.value)}
						placeholder="具体说明材料、证据或标准中需要调整的内容"
					/>
				</label>
				<Button
					disabled={busy || !content.trim() || !author.trim()}
					onClick={() =>
						run(
							{ type: "feedback", projectId: p.id, author, category, content },
							() => setContent(""),
						)
					}
				>
					保存反馈
				</Button>
				<p className="hint">反馈仅做记录；请在材料或评价卡中进行实际调整。</p>
			</Card>
			<div className="space-y-4">
				{p.feedback.length ? (
					p.feedback.map((f) => (
						<Card key={f.id} className="space-y-3 p-5">
							<div className="flex flex-wrap justify-between gap-2">
								<Badge variant="secondary" className="pill">
									{labels[f.type as keyof typeof labels]}
								</Badge>
								<span className="hint">
									{sanitize(f.author)} ·{" "}
									{new Date(f.createdAt).toLocaleDateString("zh-CN")}
								</span>
							</div>
							<p className="whitespace-pre-wrap text-sm leading-7">
								{sanitize(f.content)}
							</p>
						</Card>
					))
				) : (
					<Card className="hint p-12 text-center">还没有反馈记录。</Card>
				)}
			</div>
		</div>
	);
}
