/**
 * 共享工作台的无状态签名会话，不建立独立用户账号或服务端会话表。
 * Cookie 只携带过期时间与 HMAC 签名，不保存访问密码；签名用于防篡改，不是加密。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
export const COOKIE_NAME = "zhiheng_session";
// 浏览器 Cookie 与签名载荷使用相同的七天有效期。
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
/**
 * 统一检查会话签名密钥。更换 AUTH_SECRET 后，原有签名无法通过验证。
 */
function secret() {
	const value = process.env.AUTH_SECRET;
	if (!value || value.length < 32)
		throw new Error("请配置至少 32 位的 AUTH_SECRET");
	return value;
}
/**
 * 用服务端密钥对过期时间签名，base64url 编码适合直接放入 Cookie。
 */
function sign(value: string) {
	return createHmac("sha256", secret()).update(value).digest("base64url");
}
/**
 * 长度相同后使用 timingSafeEqual 比较字节，避免普通字符串比较的逐字符提前返回。
 * 长度检查是 Node.js timingSafeEqual 的前置要求；本函数不承诺隐藏字符串长度。
 */
export function constantEqual(a: string, b: string) {
	const aa = Buffer.from(a);
	const bb = Buffer.from(b);
	return aa.length === bb.length && timingSafeEqual(aa, bb);
}
/**
 * 生成“秒级过期时间.签名”格式的令牌。now 可注入，便于测试到期边界。
 */
export function createSession(now = Date.now()) {
	const expiry = String(Math.floor(now / 1000) + SESSION_SECONDS);
	return `${expiry}.${sign(expiry)}`;
}
/**
 * 验证令牌结构、有效期和签名；未配置密码或签名配置异常时返回未认证。
 * 该检查不查询数据库。退出登录通过清除浏览器 Cookie 完成，不维护令牌吊销名单。
 */
export function verifySession(token?: string, now = Date.now()) {
	if (!token || !process.env.APP_PASSWORD) return false;
	try {
		const parts = token.split(".");
		if (parts.length !== 2 || !/^\d+$/.test(parts[0])) return false;
		return (
			Number(parts[0]) > Math.floor(now / 1000) &&
			constantEqual(sign(parts[0]), parts[1])
		);
	} catch {
		return false;
	}
}
