/**
 * 沿用 Next 的可访问性、React 和 TypeScript 检查；生成产物不参与源码检查。
 */
import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";
export default defineConfig([
	...next,
	...ts,
	globalIgnores([".next/**", "lib/generated/**", "next-env.d.ts", "app.js"]),
]);
