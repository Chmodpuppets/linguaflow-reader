import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

// 构造一本「Gatsby 式」EPUB：spine 里混入扉页 / 目录页（contents），
// 真正的章节顺序与标题在 EPUB3 nav 目录里。旧解析按 spine 顺序会把 contents 当成章节，
// 导致「Chapter 2」显示成目录页、章节整体错位。这里回归验证 TOC 驱动的章节映射。
async function buildGatsbyEpub(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Great Gatsby</dc:title><dc:creator>F. Scott Fitzgerald</dc:creator><dc:identifier id="uid">urn:uuid:test</dc:identifier><dc:language>en</dc:language></metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="contents" href="contents.xhtml" media-type="application/xhtml+xml"/>
<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="contents"/><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/></spine>
</package>`);
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="ch1.xhtml">Chapter One</a></li><li><a href="ch2.xhtml">Chapter Two</a></li><li><a href="ch3.xhtml">Chapter Three</a></li></ol></nav></body></html>`);
  // 目录 / 扉页：只有链接没有 p/h，旧解析会把它整页拼成一段正文当成章节。
  zip.file('OEBPS/contents.xhtml', `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Contents</title></head><body><div class="contents"><a href="ch1.xhtml">CONTENTS</a><a>START READING</a><a>CHAPTER 1</a><a>CHAPTER 2</a><a>CHAPTER 3</a><a>ABOUT THE AUTHOR</a></div></body></html>`);
  zip.file('OEBPS/ch1.xhtml', `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p>In my younger and more vulnerable years my father gave me some advice.</p><p>Whenever you feel like criticizing any one, just remember that all the people in this world haven't had the advantages that you've had.</p><p>The city glittered at night. My father gave me some advice that I still remember.</p></body></html>`);
  zip.file('OEBPS/ch2.xhtml', `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter Two</title></head><body><h1>Chapter Two</h1><p>About half way between West Egg and New York the motor road hastily joins the railroad.</p><p>This is a valley of ashes — a fantastic farm where ashes grow like wheat.</p></body></html>`);
  zip.file('OEBPS/ch3.xhtml', `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter Three</title></head><body><h1>Chapter Three</h1><p>There was music from my neighbor's house through the summer nights.</p><p>In his blue gardens men and girls came and went like moths.</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function importFixture(page: import('@playwright/test').Page) {
  const buffer = await buildGatsbyEpub();
  await page.goto('/');
  await page.getByRole('button', { name: '导入 EPUB' }).click();
  await page.locator('input[type="file"][accept*="epub"]').setInputFiles({ name: 'gatsby.epub', mimeType: 'application/epub+zip', buffer });
  // 导入成功后 App 直接打开该书（setActiveBookId），落在阅读器而非书库。
  await expect(page.locator('.reader-page')).toBeVisible();
  await expect(page.locator('.reader-book-title strong')).toHaveText('The Great Gatsby');
}

test('EPUB 章节以目录为准：扉页/目录页不占章节，Chapter Two 显示真实正文', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await importFixture(page);


  // 目录只有 3 个真实章节，不含 Contents / 目录页。
  const tocTitles = page.locator('.toc-list button strong');
  await expect(tocTitles).toHaveCount(3);
  await expect(tocTitles).toHaveText(['Chapter One', 'Chapter Two', 'Chapter Three']);

  // 切到第二章，正文是真实章节内容，而不是拼接的目录页。
  await page.locator('.toc-list button', { hasText: 'Chapter Two' }).click();
  await expect(page.locator('.chapter-body')).toContainText('valley of ashes');
  await expect(page.locator('.chapter-body')).not.toContainText('CONTENTSSTART');
  await expect(page.locator('.reader-book-title span')).toHaveText('Chapter Two');
  expect(pageErrors).toEqual([]);
});

test('点词查义：本地未收录时优先服务器英汉词典，显示中文释义', async ({ page }) => {
  // 拦截 LinguaFlow 服务器词典，返回稳定中文释义，避免依赖外网。
  await page.route('**/api/dict/lookup*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ found: true, lang: 'en', word: 'vulnerable', phonetic: "'vʌlnərəbl", meaning: 'a. 易受伤害的，脆弱的，易受影响的', pos: 'a' }),
  }));
  await importFixture(page);

  // vulnerable 不在本地词库 → 走服务器英汉词典。
  await page.locator('.chapter-body .word[data-word="vulnerable"]').click();
  const panel = page.locator('.lookup-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.eyebrow')).toHaveText('SERVER DICTIONARY · 英汉');
  await expect(panel.locator('.dictionary-meaning')).toContainText('易受伤害的');
  await expect(panel.locator('.phonetic')).toContainText('vʌlnərəbl');
});

test('点词查义：服务器词典不可达时回退 Free Dictionary API', async ({ page }) => {
  await page.route('**/api/dict/lookup*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"found":false}' }));
  await page.route('**/api.dictionaryapi.dev/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ word: 'vulnerable', phonetic: '/ˈvʌlnərəbəl/', meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Susceptible to physical or emotional attack or harm.', example: 'a vulnerable child' }], synonyms: ['exposed', 'defenseless'] }] }]),
  }));
  await importFixture(page);

  await page.locator('.chapter-body .word[data-word="vulnerable"]').click();
  const panel = page.locator('.lookup-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.eyebrow')).toHaveText('ONLINE DICTIONARY');
  await expect(panel.locator('.dictionary-meaning')).toContainText('Susceptible to physical or emotional attack');
  await expect(panel.locator('.synonyms')).toContainText('exposed');
});

test('查词面板：只抓含词的那一句（非整段）+ 释义首屏 + 收藏句子进笔记页', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/dict/lookup*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ found: true, lang: 'en', word: 'advice', phonetic: "/əd'vaɪs", meaning: 'n. 建议，忠告', pos: 'n' }),
  }));
  await importFixture(page);

  // 第三段有两句；点第二句里的 advice，面板应只展示第二句，而不是整段。
  await page.locator('.chapter-body p[data-paragraph="2"] .word[data-word="advice"]').click();
  const panel = page.locator('.lookup-panel');
  await expect(panel).toBeVisible();
  // 释义在首屏（01 区块），中文释义可见。
  await expect(panel.locator('.lookup-definition .dictionary-meaning')).toContainText('建议，忠告');
  // 原句只含目标句，不含同段另一句；目标词被高亮。
  const sentence = panel.locator('.lookup-sentence');
  await expect(sentence).toContainText('that I still remember');
  await expect(sentence).not.toContainText('glittered');
  await expect(sentence.locator('mark')).toHaveText('advice');

  // 收藏句子 → 笔记页可见该句。
  await panel.getByRole('button', { name: '收藏句子' }).click();
  await expect(panel.getByRole('button', { name: '已收藏句子' })).toBeVisible();
  await panel.getByRole('button', { name: '返回原文' }).click();
  await page.getByRole('button', { name: '返回书库' }).click();
  await page.getByRole('button', { name: /标记与笔记/ }).click();
  const card = page.locator('.sentence-card', { hasText: 'that I still remember' });
  await expect(card).toBeVisible();
  await expect(card.locator('.sentence-word-row strong')).toHaveText('advice');
  await expect(card.locator('.sentence-meaning')).toContainText('建议，忠告');
  expect(pageErrors).toEqual([]);
});

// 最小可解析 WAV（8kHz mono 16-bit 静音 0.1s），用于端到端验证「绑定有声书 → 播放条出现」。
function tinyWav(): Buffer {
  const data = Buffer.alloc(1600);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24); header.writeUInt32LE(16000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test('有声书边听边看：无音频的书可就地绑定，播放条出现且可显隐', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await importFixture(page);

  // 导入的书没有音频：工具栏「有声书」按钮应打开绑定抽屉，而不是毫无入口。
  await page.getByRole('button', { name: '有声书边听边看' }).click();
  const drawer = page.locator('.reader-voice-drawer[aria-label="有声书边听边看"]');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: /绑定音频/ })).toBeVisible();

  // 就地绑定一个音频文件 → 抽屉自动收起、阅读页出现播放条。
  // 走真实交互：点「绑定音频」触发 file chooser（同时设置 targetId），再喂文件。
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    drawer.getByRole('button', { name: /绑定音频/ }).click(),
  ]);
  await chooser.setFiles({ name: 'sample.wav', mimeType: 'audio/wav', buffer: tinyWav() });
  await expect(drawer).toBeHidden({ timeout: 10000 });
  const bar = page.locator('.audiobar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.audiobar-play')).toBeVisible();

  // 工具栏按钮可显隐播放条。
  await page.getByRole('button', { name: '有声书边听边看' }).click();
  await expect(bar).toBeHidden();
  await page.getByRole('button', { name: '有声书边听边看' }).click();
  await expect(bar).toBeVisible();
  expect(pageErrors).toEqual([]);
});

// 很多转制 EPUB（AmazonClassics 等）用 <div class="para"> 或 <br> 分段而非 <p>。
// 旧解析只查 p，会漏掉全部段落、把整章拼成一坨（边界连空格都丢）。回归验证自然段保留。
async function buildDivEpub(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Div Paragraphs</dc:title><dc:creator>Test</dc:creator><dc:identifier id="uid">urn:uuid:div</dc:identifier><dc:language>en</dc:language></metadata>
<manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="ch1"/></spine>
</package>`);
  zip.file('OEBPS/ch1.xhtml', `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1><div class="para">The first paragraph stands alone.</div><div class="para">The second paragraph follows it.</div><div class="para">Third part A.<br/>Third part B.</div></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('div / br 分段的 EPUB 保留自然段，不拼成一坨', async ({ page }) => {
  const buffer = await buildDivEpub();
  await page.goto('/');
  await page.getByRole('button', { name: '导入 EPUB' }).click();
  await page.locator('input[type="file"][accept*="epub"]').setInputFiles({ name: 'div.epub', mimeType: 'application/epub+zip', buffer });
  await expect(page.locator('.reader-page')).toBeVisible();
  const paragraphs = page.locator('.chapter-body p');
  await expect(paragraphs).toHaveCount(4);
  await expect(paragraphs.nth(0)).toContainText('The first paragraph stands alone.');
  await expect(paragraphs.nth(1)).toContainText('The second paragraph follows it.');
  await expect(paragraphs.nth(2)).toContainText('Third part A.');
  await expect(paragraphs.nth(3)).toContainText('Third part B.');
  // 段落边界不粘连：第一段不含第二段文字。
  await expect(paragraphs.nth(0)).not.toContainText('second paragraph');
});

// 1x1 PNG，用于封面提取回归（createImageBitmap 可解码）。
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function buildCoverEpub(mode: 'epub2' | 'epub3'): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const coverMeta = mode === 'epub2' ? '<meta name="cover" content="coverimg"/>' : '';
  const coverProps = mode === 'epub3' ? ' properties="cover-image"' : '';
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${mode === 'epub3' ? '3.0' : '2.0'}" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Covered Book</dc:title><dc:creator>Author</dc:creator><dc:identifier id="uid">urn:uuid:cover</dc:identifier><dc:language>en</dc:language>${coverMeta}</metadata>
<manifest>
<item id="coverimg" href="cover.png" media-type="image/png"${coverProps}/>
<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="ch1"/></spine>
</package>`);
  zip.file('OEBPS/cover.png', TINY_PNG);
  zip.file('OEBPS/ch1.xhtml', `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p>The covered book opens with a single clear paragraph.</p></body></html>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

for (const mode of ['epub2', 'epub3'] as const) {
  test(`提取 EPUB 真实封面（${mode}）：书库展示封面图而非生成封面`, async ({ page }) => {
    const buffer = await buildCoverEpub(mode);
    await page.goto('/');
    await page.getByRole('button', { name: '导入 EPUB' }).click();
    await page.locator('input[type="file"][accept*="epub"]').setInputFiles({ name: 'covered.epub', mimeType: 'application/epub+zip', buffer });
    await expect(page.locator('.reader-page')).toBeVisible();
    // 回到书库查看封面。
    await page.getByRole('button', { name: '返回书库' }).click();
    const card = page.locator('.book-card', { hasText: 'Covered Book' });
    const cover = card.locator('.book-cover.has-image img.book-cover-img');
    await expect(cover).toBeVisible();
    const src = await cover.getAttribute('src');
    expect(src?.startsWith('data:image/')).toBe(true);
    // 有真实封面时该书不再渲染生成封面的文字块（样书仍用生成封面）。
    await expect(card.locator('.book-cover strong')).toHaveCount(0);
  });
}
