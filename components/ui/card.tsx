/**
 * 卡片的容器、标题、说明、内容和页脚包装，统一间距与文字层级。
 * 保留原生 div 属性，允许调用方添加布局和可访问性信息，不承载业务状态。
 */
import * as React from "react";
import { cn } from "@/lib/utils";
export function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card"
			className={cn(
				"rounded-xl border bg-card text-card-foreground shadow-xs",
				className,
			)}
			{...props}
		/>
	);
}
export function CardHeader({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn("flex flex-col gap-2 p-6", className)}
			{...props}
		/>
	);
}
export function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
	return (
		<h2
			data-slot="card-title"
			className={cn("font-semibold leading-none", className)}
			{...props}
		/>
	);
}
export function CardContent({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-content"
			className={cn("p-6 pt-0", className)}
			{...props}
		/>
	);
}
