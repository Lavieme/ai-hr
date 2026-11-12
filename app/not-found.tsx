/**
 * 项目不存在或其他路由未匹配时的统一返回入口，不向客户端暴露数据库查找细节。
 */
import Link from "next/link";
export default function NotFound() {
	return (
		<main className="p-12 text-center">
			<h1 className="page-title">项目不存在</h1>
			<Link href="/" className="mt-6 inline-block text-primary">
				返回所有项目 →
			</Link>
		</main>
	);
}
