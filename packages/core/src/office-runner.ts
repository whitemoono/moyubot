/**
 * 云机侧入口：接收请求，用内联的依赖生成文件，返回 Buffer。
 * 由 scripts/bundle-office.mjs 打包成自包含 CJS 推到云电脑执行。
 */
import { buildDocument, buildSlides, buildSpreadsheet, type DeckSlide, type DocBlock, type SheetSpec } from './office';

export async function run(payload: {
  kind: 'xlsx' | 'docx' | 'pptx';
  spreadsheet?: SheetSpec[];
  document?: { title?: string; blocks: DocBlock[] };
  slides?: { title?: string; slides: DeckSlide[] };
}): Promise<Buffer> {
  if (payload.kind === 'xlsx') return buildSpreadsheet(payload.spreadsheet ?? []);
  if (payload.kind === 'docx') return buildDocument(payload.document ?? { blocks: [] });
  if (payload.kind === 'pptx') return buildSlides(payload.slides ?? { slides: [] });
  throw new Error(`不支持的格式：${payload.kind}`);
}