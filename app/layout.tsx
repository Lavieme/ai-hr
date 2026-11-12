/**
 * 全站根布局：统一中文页面语言、站点元数据、全局样式和操作反馈通知。
 * 布局本身在服务端渲染；Toaster 是独立的客户端提示组件，不会让整个页面变成客户端组件。
 */
import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";
/**
 * 浏览器标签标题与页面描述，与各项目里的岗位名称分开维护。
 */
export const metadata: Metadata = {
	title: "知衡 · 校招筛选工作台",
	description: "从 JD 和简历开始，完成人工复核与名单交付",
};
/**
 * 保留子路由自己的服务端/客户端边界，统一在右下角显示保存成功、校验失败等通知。
 */
export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="zh-CN">
			<body>
				{children}
				<Toaster richColors position="bottom-right" />
			</body>
		</html>
	);
}
