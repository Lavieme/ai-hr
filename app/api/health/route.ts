/**
 * 部署健康检查入口：只验证应用能否查询数据库，不要求用户会话。
 * AI 和 S3 是按需使用的外部服务，不纳入存活检查，避免供应商临时故障触发应用重启。
 */
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
/**
 * 数据库可查询时返回 200；异常时只返回 503 和简短状态，不暴露连接字符串或数据库错误细节。
 */
export async function GET() {
	try {
		await db.$queryRaw`SELECT 1`;
		return Response.json({ status: "ok" });
	} catch {
		return Response.json({ status: "unavailable" }, { status: 503 });
	}
}
