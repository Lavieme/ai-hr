"use client";
/**
 * 登录表单内的客户端提交按钮；仅负责展示当前表单的提交状态。
 */
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
/**
 * useFormStatus 必须处于对应 form 的子树内；pending 时禁用按钮，避免重复提交登录请求。
 */
export function PendingButton({ children }: { children: React.ReactNode }) {
	const { pending } = useFormStatus();
	return (
		<Button type="submit" disabled={pending} className="w-full">
			{pending ? "正在登录…" : children}
		</Button>
	);
}
