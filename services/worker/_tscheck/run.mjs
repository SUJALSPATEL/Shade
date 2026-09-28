const B = new URL('../../../packages/shared/src/mock/', import.meta.url).href;
const { buildChunks, buildFigureSvg, buildStructuredDocument } = await import(B + 'fixture-document.ts');
const { renderMarkdown, markdownByteLength } = await import(B + 'markdown.ts');
const { retrieve, runExtract, runSplit, runParse } = await import(B + 'engine.ts');
const { writeFileSync } = await import('node:fs');

const chunks = buildChunks();
const svg = buildFigureSvg();
const structured = buildStructuredDocument();
const md = renderMarkdown({
  document: structured,
  assetPaths: { 'image-001.svg': 'assets/image-001.svg' },
  assetCaptions: { 'image-001.svg': 'Revenue distribution by region, FY2025' },
});
const doc = { id: 'doc_1', filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 1024, pageCount: null, title: null, author: null, createdAt: '2026-01-01T00:00:00.000Z' };

writeFileSync('_tscheck/out_chunks.json', JSON.stringify(chunks, null, 1));
writeFileSync('_tscheck/out_svg.txt', svg);
writeFileSync('_tscheck/out_markdown.txt', md);
writeFileSync('_tscheck/out_structured.json', JSON.stringify(structured, null, 1));

const queries = [
  'Find the section about employee benefits.',
  'Find chunks related to termination clauses.',
  'What was the revenue growth in India?',
  'Which regions performed best?',
  'What are the principal risks?',
];
writeFileSync('_tscheck/out_split.json', JSON.stringify(
  Object.fromEntries(queries.map(q => [q, retrieve(q)])), null, 1));

const fields = [
  { name: 'company_name', type: 'string', required: true },
  { name: 'reporting_period', type: 'string', required: true },
  { name: 'total_revenue', type: 'number', required: true },
  { name: 'revenue_growth_pct', type: 'number', required: false },
  { name: 'operating_margin_pct', type: 'number', required: false },
  { name: 'regions', type: 'array<object>', required: false },
  { name: 'nonsense_field', type: 'string', required: true },
];
writeFileSync('_tscheck/out_extract.json', JSON.stringify(
  runExtract(doc, { name: 'Financial summary', fields }, { startedAtMs: 1735689600000, nowMs: 1735689602610 }), null, 1));
const parseOut = runParse(doc, { startedAtMs: 1735689600000, nowMs: 1735689601840 });
writeFileSync('_tscheck/out_parse.json', JSON.stringify(parseOut.result, null, 1));
console.log('OK chunks=%d svgBytes=%d mdBytes=%d', chunks.length, markdownByteLength(svg), markdownByteLength(md));
