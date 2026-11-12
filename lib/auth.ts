/**
 * Next.js 服务端认证适配层：页面需要重定向，API 则需要明确的 HTTP 错误响应。
 * 所有业务入口都应在读取或修改数据前调用对应的认证函数。
 */
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, verifySession } from "./session";
/**
 * 从当前请求的 Cookie 中读取签名会话并验证；不接收客户端声称的登录状态。
 */
export async function isAuthenticated() {
	return verifySession((await cookies()).get(COOKIE_NAME)?.value);
}
/**
 * 供 Server Component 和 Server Action 使用；Next.js 的 redirect 会抛出框架内部控制信号。
 * 调用时不要把该信号吞进通用业务错误处理，否则浏览器无法正常跳转到登录页。
 */
export async function requireAuth() {
	if (!(await isAuthenticated())) redirect("/login");
}
/**
 * 供 Route Handler 使用：未登录返回 401，而不是把 API 调用重定向到 HTML 登录页。
 * 对携带 Origin 的写请求检查同源关系；APP_URL 允许反向代理后的外部应用地址。
 * 不携带 Origin 的服务端请求不会在此处被来源检查拒绝，但仍须有有效会话。
 */
export async function requireApiAuth(request?: Request) {
	if (!(await isAuthenticated())) throw new HttpError(401, "请先登录工作台");
	if (request && !["GET", "HEAD"].includes(request.method)) {
		const origin = request.headers.get("origin");
		if (
			origin &&
			origin !== new URL(request.url).origin &&
			origin !== process.env.APP_URL
		)
			throw new HttpError(403, "请求来源不匹配");
	}
}
/**
 * 携带预期 HTTP 状态码的业务错误，供 API 统一响应函数识别。
 */
export class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}
/**
 * 将预期错误转换为 JSON；其他校验或业务错误按 400 返回并记录错误消息。
 * 只记录 message，不序列化整个 Request、Cookie 或模型调用参数。
 */
export function apiError(error: unknown) {
	if (error instanceof HttpError)
		return Response.json({ error: error.message }, { status: error.status });
	console.error(error instanceof Error ? error.message : "Request failed");
	return Response.json(
		{ error: error instanceof Error ? error.message : "操作失败，请重试" },
		{ status: 400 },
	);
}
