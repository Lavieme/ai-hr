/**
 * shadcn 组件共享的样式合并工具，保持组件默认样式与业务页面覆盖样式的合并方式一致。
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
/**
 * 先用 clsx 展开条件类名，再用 tailwind-merge 处理冲突；后传入的同类工具样式可覆盖前面的默认值。
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
