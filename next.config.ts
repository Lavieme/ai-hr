/**
 * 生成 standalone 产物供 Docker 独立运行。
 * PDF 解析及其原生依赖留给 Node 运行时加载，避免打包器改写动态依赖路径。
 */
import type { NextConfig } from "next";
const config: NextConfig = {
	output: "standalone",
	serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
};
export default config;
