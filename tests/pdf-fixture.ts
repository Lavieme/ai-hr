/**
 * 生成最小 PDF 测试材料，避免依赖外部文档或真实候选人信息。
 * pages 用于验证页数上限；blank 生成无文字页面，用于验证需要手动补充正文的场景。
 */
export function makePdf(pages = 1, blank = false) {
	// 对象依次包含目录、页面树、字体，再为每页添加页面对象与内容流。
	const objects: string[] = [];
	objects.push("<< /Type /Catalog /Pages 2 0 R >>");
	objects.push(
		`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages} >>`,
	);
	objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
	for (let i = 0; i < pages; i++) {
		const stream = blank
			? ""
			: `BT /F1 12 Tf 40 700 Td (Candidate led user research and delivered a product with a team. Page ${i + 1}) Tj ET`;
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
		);
		objects.push(
			`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		);
	}
	let pdf = "%PDF-1.4\n";
	// xref 必须记录每个对象在最终文件中的字节偏移，而不是字符串字符位置。
	const offsets = [0];
	objects.forEach((o, i) => {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	// 末尾交叉引用表和 trailer 让标准 PDF 解析器可以定位所有对象。
	const xref = Buffer.byteLength(pdf);
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	offsets.slice(1).forEach((o) => {
		pdf += `${String(o).padStart(10, "0")} 00000 n \n`;
	});
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return Buffer.from(pdf);
}
