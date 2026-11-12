/**
 * 服务端查询结果传给客户端工作台时使用的类型约定。
 * 这里只导入 FullProject 的类型，不把数据库查询实现或 Prisma 运行时代码打包到浏览器。
 */
import type { FullProject } from "./projects";
/**
 * 递归把 Date 映射为字符串，同时保留数组和对象的结构。
 * 对应项目详情页 JSON 序列化后的实际数据形状，不执行任何运行时转换。
 */
type Serialized<T> = T extends Date
	? string
	: T extends (infer U)[]
		? Serialized<U>[]
		: T extends object
			? { [K in keyof T]: Serialized<T[K]> }
			: T;
// 客户端看到的完整项目，以及从项目类型派生的单个候选人类型。
export type WorkProject = Serialized<FullProject>;
export type WorkCandidate = WorkProject["candidates"][number];
/**
 * 单项 AI 线索的展示结构。quotes 是逐字引用，missing 和 question 分别是缺失信息与追问建议。
 * 它不包含 HR 人工判断状态，选取 AI 引用后仍需要人工确认。
 */
export type AiItem = {
	criterionId: string;
	quotes: string[];
	missing: string;
	question: string;
};
// 模板下拉框只需标识和名称；实际模板内容在服务端应用时读取。
export type TemplateOption = { id: string; name: string };
