/**
 * 原生多行输入框的样式封装，保留表单行为与受控值传递。
 * 这里只处理外观；长度约束、内容清理及持久化由业务层负责。
 */
import * as React from "react";
import { cn } from "@/lib/utils";
export function Textarea({
	className,
	...props
}: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"flex min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-7 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
