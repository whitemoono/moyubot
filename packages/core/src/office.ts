/**
 * Office 文件生成器：纯 JS，不依赖 Python / 系统库。
 * 本机直接调用；云电脑把同一份逻辑作为脚本跑（任何 driver 都能用）。
 *
 * 输入是结构化数据，输出是文件字节：
 *  - buildSpreadsheet(sheets) → .xlsx
 *  - buildDocument(doc)       → .docx
 *  - buildSlides(deck)        → .pptx
 */
import ExcelJS from 'exceljs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType,
} from 'docx';
import PptxGenJS from 'pptxgenjs';

export interface SheetSpec {
  name?: string;
  columns?: { header: string; width?: number }[];
  rows: (string | number | null)[][];
  /** 置顶标题行（可选），与 columns 同时存在时标题在表头之上 */
  title?: string;
  freezeHeader?: boolean;
}

export interface DocBlock {
  /** heading1..3 / paragraph / bullets / table / pageBreak */
  type: 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullets' | 'table' | 'pageBreak';
  text?: string;
  bold?: boolean;
  /** bullets 用 */
  items?: string[];
  /** table 用 */
  columns?: string[];
  rows?: string[][];
}

export interface DeckSlide {
  title?: string;
  bullets?: string[];
  /** 副标题（标题页风格） */
  subtitle?: string;
  notes?: string;
}

/** .xlsx：列宽、表头加粗、冻结首行、标题行合并。 */
export async function buildSpreadsheet(sheets: SheetSpec[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MoyuBot';
  workbook.created = new Date();
  for (const spec of sheets) {
    const sheet = workbook.addWorksheet((spec.name ?? 'Sheet1').slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), {
      views: spec.freezeHeader ? [{ state: 'frozen', ySplit: spec.title ? 2 : 1 }] : undefined,
    });
    if (spec.title) {
      const width = Math.max(spec.columns?.length ?? 1, spec.rows[0]?.length ?? 1);
      sheet.addRow([spec.title]);
      sheet.mergeCells(1, 1, 1, width);
      sheet.getCell(1, 1).font = { bold: true, size: 14 };
      sheet.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getRow(1).height = 24;
    }
    if (spec.columns?.length) {
      const header = sheet.addRow(spec.columns.map((column) => column.header));
      header.font = { bold: true };
      header.alignment = { vertical: 'middle' };
      spec.columns.forEach((column, index) => {
        if (column.width) sheet.getColumn(index + 1).width = column.width;
      });
    }
    for (const row of spec.rows) sheet.addRow(row);
    // 自动列宽（未显式指定时按内容估算）
    if (!spec.columns?.some((column) => column.width)) {
      const columnCount = Math.max(spec.columns?.length ?? 0, ...spec.rows.map((row) => row.length), 1);
      for (let index = 1; index <= columnCount; index++) {
        const lengths = [spec.columns?.[index - 1]?.header ?? '', ...spec.rows.map((row) => String(row[index - 1] ?? ''))]
          .map((text) => String(text).length);
        sheet.getColumn(index).width = Math.min(60, Math.max(8, Math.max(...lengths) + 2));
      }
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** .docx：标题层级、段落、要点列表、表格、分页。 */
export async function buildDocument(spec: { title?: string; blocks: DocBlock[] }): Promise<Buffer> {
  const headingMap = { heading1: HeadingLevel.HEADING_1, heading2: HeadingLevel.HEADING_2, heading3: HeadingLevel.HEADING_3 } as const;
  const children: (Paragraph | Table)[] = [];
  if (spec.title) children.push(new Paragraph({ text: spec.title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 300 } }));
  for (const block of spec.blocks) {
    if (block.type === 'pageBreak') { children.push(new Paragraph({ children: [], pageBreakBefore: true })); continue; }
    if (block.type === 'table') {
      const columns = block.columns ?? [];
      const rows = block.rows ?? [];
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: columns.map((header) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: header, bold: true })] })] })) }),
          ...rows.map((row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph(String(cell ?? ''))] })) })),
        ],
      }));
      children.push(new Paragraph(''));
      continue;
    }
    if (block.type === 'bullets') {
      for (const item of block.items ?? []) children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
      continue;
    }
    if (block.type === 'paragraph') {
      children.push(new Paragraph({ children: [new TextRun({ text: block.text ?? '', bold: block.bold })] }));
      continue;
    }
    children.push(new Paragraph({ text: block.text ?? '', heading: headingMap[block.type] }));
  }
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

/** .pptx：标题页 + 要点页，自动换行分页，附备注。 */
export async function buildSlides(deck: { title?: string; slides: DeckSlide[] }): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  if (deck.title) {
    const cover = pptx.addSlide();
    cover.addText(deck.title, { x: 0.6, y: 2.1, w: 8.8, h: 1.4, fontSize: 34, bold: true, align: 'center' });
  }
  for (const slideSpec of deck.slides) {
    const slide = pptx.addSlide();
    if (slideSpec.title) slide.addText(slideSpec.title, { x: 0.5, y: 0.35, w: 9, h: 0.9, fontSize: 24, bold: true });
    let y = slideSpec.title ? 1.4 : 0.8;
    if (slideSpec.subtitle) { slide.addText(slideSpec.subtitle, { x: 0.6, y, w: 8.8, h: 0.7, fontSize: 16, color: '555555' }); y += 0.8; }
    const bullets = slideSpec.bullets ?? [];
    if (bullets.length) {
      // 要点过多时自动缩小字号，尽量一页放下
      const fontSize = bullets.length > 8 ? 12 : bullets.length > 6 ? 14 : 16;
      slide.addText(bullets.map((item) => ({ text: item, options: { bullet: true } })), { x: 0.7, y, w: 8.6, h: 4.6, fontSize, lineSpacingMultiple: 1.2 });
    }
    if (slideSpec.notes) slide.addNotes(slideSpec.notes);
  }
  return Buffer.from(await pptx.write({ outputType: 'nodebuffer' }) as Buffer);
}