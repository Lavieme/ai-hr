/**
 * S3 兼容对象存储封装：本地 MinIO 兼容服务与生产 S3 使用同一接口。
 * 数据库只保存对象 key 和附件元数据，私有下载地址在用户发起下载时临时签名。
 * 本模块没有本地磁盘回退；未配置 S3 时，用户仍可使用纯文本粘贴流程。
 */
import "server-only";
import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
/**
 * 检测文件操作所需的基础配置。AWS S3 可省略 endpoint，SDK 会按 bucket 区域解析服务地址。
 */
export function storageConfigured() {
	return !!(
		process.env.OSS_ACCESS_KEY_ID &&
		process.env.OSS_SECRET_ACCESS_KEY &&
		process.env.OSS_BUCKET
	);
}
/**
 * 创建服务端 S3 客户端。publicEndpoint 为 true 时，使用浏览器可访问的地址生成下载签名。
 * Compose 内部上传可访问 http://minio:9000，而浏览器需要 localhost 或外部域名；两者分别配置。
 * 签名时直接使用目标 endpoint，不能生成后随意改写 URL，因为 Host 参与签名校验。
 */
function client(publicEndpoint = false) {
	if (!storageConfigured())
		throw new Error("对象存储未配置，请先使用文本粘贴，或配置 OSS_* 环境变量");
	return new S3Client({
		region: process.env.OSS_REGION || "us-east-1",
		endpoint:
			(publicEndpoint && process.env.OSS_PUBLIC_ENDPOINT) ||
			process.env.OSS_ENDPOINT ||
			undefined,
		// 本地兼容服务通常使用路径式 bucket 地址；生产按存储服务要求配置，不强制同一种寻址方式。
		forcePathStyle: process.env.OSS_FORCE_PATH_STYLE === "true",
		credentials: {
			accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
			secretAccessKey: process.env.OSS_SECRET_ACCESS_KEY!,
		},
	});
}
/**
 * 把原件上传到配置的前缀下，以随机 UUID 命名，避免同名文件覆盖和把姓名直接暴露在对象 key 中。
 * 返回稳定 key 而非下载 URL；文件名称另存附件表，上传失败直接抛错。
 */
export async function uploadFile(buffer: Buffer, ext: string, mime: string) {
	const prefix = (process.env.OSS_PATH_PREFIX || "ai-hr").replace(
		/^\/+|\/+$/g,
		"",
	);
	const key = `${prefix}/${randomUUID()}.${ext}`;
	await client().send(
		new PutObjectCommand({
			Bucket: process.env.OSS_BUCKET,
			Key: key,
			Body: buffer,
			ContentType: mime,
		}),
	);
	return key;
}
/**
 * 为私有对象生成短期 GET 地址，并指定 attachment 下载。
 * 默认有效期 300 秒；签名是否可生成不等于文件存在，最终读取由存储服务检查。
 */
export async function downloadUrl(key: string) {
	return getSignedUrl(
		client(true),
		new GetObjectCommand({
			Bucket: process.env.OSS_BUCKET,
			Key: key,
			ResponseContentDisposition: "attachment",
		}),
		{ expiresIn: Number(process.env.OSS_PRESIGN_EXPIRES_IN || 300) },
	);
}
/**
 * 批量删除给定对象，空列表不发请求。
 * S3 批量接口即使返回成功响应，也可能在 Errors 中报告逐项失败，因此必须额外检查。
 */
export async function removeFiles(keys: string[]) {
	if (!keys.length) return;
	const result = await client().send(
		new DeleteObjectsCommand({
			Bucket: process.env.OSS_BUCKET,
			Delete: { Objects: keys.map((Key) => ({ Key })) },
		}),
	);
	if (result.Errors?.length) throw new Error("部分原件删除失败，请重试");
}
