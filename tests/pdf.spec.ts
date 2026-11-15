import { test, expect } from './base';

// 生成一个带文字层的最小合法 PDF（正确 xref 偏移），供 pdf.js 解析。
function buildPdf(textLines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const ops = ['BT', '/F1 12 Tf', '72 720 Td', '16 TL'];
  for (const line of textLines) ops.push(`(${esc(line)}) Tj`, 'T*');
  ops.push('ET');
  const stream = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(body);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += xref + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

test('PDF 导入：提取文字层成章节与多段', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  const pdf = buildPdf([
    'Chapter 1: The Beginning',
    'It was a bright cold day in April, and the clocks were striking thirteen.',
    '',
    'Winston Smith kept his head down against the wind.',
    'Chapter 2: The Road',
    'The road wound on through the hills and quiet valleys.',
  ]);
  await page.getByRole('button', { name: '导入书籍' }).click();
  await page.locator('.dropzone input[type="file"]').setInputFiles({ name: 'nineteen-eighty-four.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.locator('.reader-page')).toBeVisible();
  await expect(page.locator('.chapter-body')).toContainText('bright cold day');
  // 章节识别：目录里应有两章（宽视口下目录默认展开）
  await expect(page.locator('.toc-list button')).toHaveCount(2);
  expect(pageErrors).toEqual([]);
});

test('PDF 导入：扫描版（无文字层）给出明确提示', async ({ page }) => {
  await page.goto('/');
  const empty = buildPdf([]); // 无文本内容
  await page.getByRole('button', { name: '导入书籍' }).click();
  await page.locator('.dropzone input[type="file"]').setInputFiles({ name: 'scanned.pdf', mimeType: 'application/pdf', buffer: empty });
  await expect(page.locator('.toast')).toContainText('没有可提取的文字');
});
