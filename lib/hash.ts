/**
 * 仅服务端使用的文本指纹工具；与可在浏览器中使用的 domain 模块分开，避免引入 Node.js 加密依赖。
 */
import { createHash } from "node:crypto";
/**
 * 去除所有空白并转为小写后计算 SHA-256，用于同一项目内的精确重复检测。
 * 忽略排版差异，不做语义相似度匹配，也不用于密码存储。
 */
export function hashText(text: string) {
	return createHash("sha256")
		.update(text.replace(/\s+/g, "").toLowerCase())
		.digest("hex");
}
