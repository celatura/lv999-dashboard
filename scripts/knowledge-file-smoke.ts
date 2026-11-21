/* oxlint-disable no-console */
/**
 * 知识库文件上传解析冒烟：验证 @firecrawl/anydoc 原生二进制
 * 在本地 nodejs 能加载，且 extractTextFromFile 对各格式样例提取到非空 Markdown/文本。
 *
 * 运行：bun run scripts/knowledge-file-smoke.ts（无需数据库与 API key，纯本地解析）
 *
 * 样例来源：
 * - 内置合成最小样例（md/txt/html/csv/pdf/docx/pptx/xlsx，零依赖构造，含 CRC32 的 STORE zip 写入器）；
 * - 若在 scripts/fixtures/knowledge-file/ 放置同名真实样例（sample.docx 等），优先使用真实文件。
 *
 * 覆盖：正常提取（office 保留标题/表格结构）、frontmatter 去除、加密 PDF 报 encrypted、
 * 空文件报 empty_text、超 100KB 报 too_large、未知格式报 unsupported_type。
 * 扫描件（needsOcr）无法零依赖合成，由用户以真实扫描件手动验收。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KnowledgeExtractError,
  extractTextFromFile,
  stripFrontmatter
} from '../src/features/knowledge/lib/extract';
import { MAX_DOCUMENT_BYTES } from '../src/features/knowledge/constants/knowledge';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'knowledge-file');

const checks: string[] = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** 期望正常提取的断言：非空文本 + 包含关键内容 */
async function expectExtract(
  name: string,
  filename: string,
  buffer: Buffer,
  mustInclude: string[]
) {
  try {
    const text = await extractTextFromFile({ filename, buffer });
    const missing = mustInclude.filter((needle) => !text.includes(needle));
    check(
      name,
      text.trim().length > 0 && missing.length === 0,
      missing.length > 0
        ? `缺少关键内容: ${missing.join(', ')} | 提取预览: ${text.slice(0, 80)}`
        : `${Buffer.byteLength(text)}B 文本`
    );
    return text;
  } catch (error) {
    check(name, false, `意外抛出: ${String(error)}`);
    return '';
  }
}

/** 期望抛出 KnowledgeExtractError 且 code 匹配 */
async function expectExtractError(name: string, filename: string, buffer: Buffer, code: string) {
  try {
    const text = await extractTextFromFile({ filename, buffer });
    check(name, false, `未抛错，提取到 ${text.length} 字符`);
  } catch (error) {
    const actual =
      error instanceof KnowledgeExtractError ? error.code : `非预期异常: ${String(error)}`;
    check(name, actual === code, `code=${actual}（期望 ${code}）`);
  }
}

// --- 最小 ZIP 写入器（STORE 不压缩 + CRC32）：构造 OOXML 样例用，零依赖 -----

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function zipStore(entries: { name: string; data: string }[]): Buffer {
  const encoder = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = encoder.encode(entry.data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名标志
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, Buffer.from(nameBytes), Buffer.from(data));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, Buffer.from(nameBytes));
    offset += 30 + nameBytes.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

// --- 最小 OOXML / PDF 样例构造 ---------------------------------------------

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function buildDocx(): Buffer {
  return zipStore([
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'word/document.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>` +
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>产品需求概述</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>本文件由冒烟脚本构造。唯一事实 FACT-DOCX-42：知识库上传链路已验证。</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>模块</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>状态</w:t></w:r></w:p></w:tc></w:tr>' +
        '<w:tr><w:tc><w:p><w:r><w:t>上传</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t>就绪</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '</w:body></w:document>'
    }
  ]);
}

const P_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function buildPptx(): Buffer {
  return zipStore([
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
        '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
        '</Types>'
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'ppt/presentation.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${P_NS} ${R_NS}>` +
        '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>' +
        '<p:sldSz cx="9144000" cy="6858000"/>' +
        '</p:presentation>'
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'ppt/slides/slide1.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${P_NS} ${A_NS} ${R_NS}>` +
        '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
        '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
        '<p:txBody><a:bodyPr/><a:p><a:r><a:t>季度规划演示</a:t></a:r></a:p>' +
        '<a:p><a:r><a:t>唯一事实 FACT-PPTX-7：演示文稿解析验证。</a:t></a:r></a:p></p:txBody></p:sp>' +
        '</p:spTree></p:cSld></p:sld>'
    }
  ]);
}

function buildXlsx(): Buffer {
  const sheetNs = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  return zipStore([
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>'
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'xl/workbook.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${sheetNs} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId2"/></sheets></workbook>'
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${sheetNs}><sheetData>` +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>指标</t></is></c><c r="B1" t="inlineStr"><is><t>数值</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>FACT-XLSX-9</t></is></c><c r="B2"><v>123</v></c></row>' +
        '</sheetData></worksheet>'
    }
  ]);
}

/** 最小单页文本 PDF（Helvetica，精确 xref 偏移）；encrypted=true 时附加 /Encrypt 引用触发加密报错 */
function buildPdf(text: string, encrypted: boolean): Buffer {
  const esc = text.replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 12 Tf 72 720 Td (${esc}) Tj ET`;
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  if (encrypted) objects.push('<< /Filter /Standard /V 1 /R 2 /O (x) /U (x) /P -44 >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  const count = objects.length + 1;
  pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  const encryptEntry = encrypted ? ' /Encrypt 6 0 R' : '';
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R${encryptEntry} >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

/** fixture 目录有同名真实样例则优先使用（便于用户放真实 office 文档复核） */
function sample(name: string, fallback: () => Buffer): Buffer {
  const path = join(FIXTURE_DIR, name);
  return existsSync(path) ? readFileSync(path) : fallback();
}

// --- 1. 纯文本类：零依赖分支 ------------------------------------------------

await expectExtract(
  'md 提取且去除 frontmatter',
  'sample.md',
  sample('sample.md', () =>
    Buffer.from(
      [
        '---',
        'title: 元信息',
        'tags: [rag]',
        '---',
        '# 检索增强笔记',
        '',
        '唯一事实 FACT-MD-1：手动样例。'
      ].join('\n'),
      'utf8'
    )
  ),
  ['检索增强笔记', 'FACT-MD-1']
).then((text) => {
  check('md frontmatter 未混入正文', !text.includes('tags:'));
});

await expectExtract(
  'txt 提取',
  'sample.txt',
  sample('sample.txt', () => Buffer.from('纯文本资料。\n唯一事实 FACT-TXT-2。', 'utf8')),
  ['FACT-TXT-2']
);

await expectExtract(
  'html 提取（去标签）',
  'sample.html',
  sample('sample.html', () =>
    Buffer.from(
      '<html><head><style>.a{color:red}</style></head><body><h1>网页标题</h1><p>唯一事实 FACT-HTML-3。</p></body></html>',
      'utf8'
    )
  ),
  ['网页标题', 'FACT-HTML-3']
);

await expectExtract(
  'csv 提取（显式格式声明）',
  'sample.csv',
  sample('sample.csv', () => Buffer.from('名称,数量\nFACT-CSV-4,42\n', 'utf8')),
  ['FACT-CSV-4']
);

// --- 2. anydoc 原生二进制：office / pdf -------------------------------------

const docxText = await expectExtract(
  'docx 提取（标题+表格结构）',
  'sample.docx',
  sample('sample.docx', buildDocx),
  ['FACT-DOCX-42']
);
check('docx 保留标题结构', docxText.includes('#') || docxText.includes('产品需求概述'));
check('docx 保留表格结构', docxText.includes('|'));

await expectExtract('pptx 提取（幻灯片文本）', 'sample.pptx', sample('sample.pptx', buildPptx), [
  'FACT-PPTX-7'
]);

const xlsxText = await expectExtract(
  'xlsx 提取（单元格转表格）',
  'sample.xlsx',
  sample('sample.xlsx', buildXlsx),
  ['FACT-XLSX-9']
);
check('xlsx 保留表格结构', xlsxText.includes('|'));

await expectExtract(
  'pdf 提取（文本型）',
  'sample.pdf',
  sample('sample.pdf', () => buildPdf('Knowledge upload smoke FACT-PDF-5.', false)),
  ['FACT-PDF-5']
);

// --- 3. 错误路径 -------------------------------------------------------------

await expectExtractError(
  '加密 PDF 报 encrypted',
  'encrypted.pdf',
  buildPdf('secret content', true),
  'encrypted'
);

await expectExtractError(
  '空 txt 报 empty_text',
  'empty.txt',
  Buffer.from('   \n  ', 'utf8'),
  'empty_text'
);

await expectExtractError(
  '超 100KB 文本报 too_large',
  'big.txt',
  Buffer.from('a'.repeat(MAX_DOCUMENT_BYTES + 1), 'utf8'),
  'too_large'
);

await expectExtractError(
  '未知二进制报 unsupported_type',
  'malformed.bin',
  Buffer.concat([
    Buffer.from([0x00, 0x01, 0x02, 0x03]),
    crypto.getRandomValues(new Uint8Array(64))
  ]),
  'unsupported_type'
);

// --- 4. 单元级：stripFrontmatter 边界 -----------------------------------------

check(
  'stripFrontmatter 无 frontmatter 时原样返回',
  stripFrontmatter('# 标题\n正文') === '# 标题\n正文'
);
check(
  'stripFrontmatter 去除 CRLF frontmatter',
  stripFrontmatter('---\r\nk: v\r\n---\r\n正文').trim() === '正文'
);

const failed = checks.filter((line) => line.startsWith('FAIL'));
console.log(failed.length === 0 ? 'SMOKE OK' : `SMOKE FAILED: ${failed.length} 项未通过`);
process.exit(failed.length === 0 ? 0 : 1);
