/**
 * 原生 input 的样式封装：保留 type、文件选择、受控值和表单属性。
 * 仅统一外观、禁用与错误样式；文件大小及输入内容必须在服务端再次校验。
 */
import * as React from "react";
import { cn } from "@/lib/utils";
export function Input({
	className,
	type,
	...props
}: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(
				"flex h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
