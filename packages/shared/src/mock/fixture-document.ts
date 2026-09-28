import type { ChunkType } from '../constants.js';
import type {
  BoundingBox,
  DocumentChunk,
  StructuredDocument,
  StructuredSection,
  StructuredTable,
} from '../types.js';

/**
 * The canonical mocked document.
 *
 * Everything the processing plane produces in this milestone derives from this
 * one fixture, so the Parse, Extract and Split surfaces all describe the same
 * document — a user who parses it, extracts from it and searches it sees a
 * coherent story rather than three unrelated placeholder payloads.
 *
 * The Python worker mirrors this file (`services/worker/shade_worker/fixtures.py`).
 * When a real engine lands, both are deleted; nothing outside the processors
 * imports them.
 */

/** A4 in PDF points. Chunk coordinates are relative to this page box. */
export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;

const MARGIN_X = 64;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

interface ChunkSpec {
  type: ChunkType;
  text: string;
  y: number;
  height: number;
  confidence?: number;
  headingLevel?: number;
  /** Overrides the default full-content-width box. */
  box?: Partial<BoundingBox>;
}

interface PageSpec {
  pageNumber: number;
  chunks: ChunkSpec[];
}

/** Positioned region definitions, grouped by page, in reading order. */
const PAGES: PageSpec[] = [
  {
    pageNumber: 1,
    chunks: [
      {
        type: 'header',
        text: 'Northwind Analytics · Annual Report 2025',
        y: 34,
        height: 12,
        confidence: 0.97,
      },
      {
        type: 'heading',
        text: 'Annual Report 2025',
        y: 80,
        height: 36,
        confidence: 0.99,
        headingLevel: 1,
      },
      {
        type: 'paragraph',
        text: 'Northwind Analytics is pleased to present its consolidated results for the fiscal year ended 31 December 2025. Revenue grew across every operating region, with the strongest expansion in the Asia-Pacific segment.',
        y: 130,
        height: 62,
        confidence: 0.96,
      },
      {
        type: 'heading',
        text: 'Executive Summary',
        y: 212,
        height: 26,
        confidence: 0.99,
        headingLevel: 2,
      },
      {
        type: 'paragraph',
        text: 'Total revenue for the year reached USD 482.6 million, an increase of 18.4 percent over the prior year. Growth was driven by the Enterprise Data Platform, which now accounts for 41 percent of consolidated revenue and continues to expand its margin profile as delivery scales.',
        y: 250,
        height: 78,
        confidence: 0.95,
      },
      {
        type: 'paragraph',
        text: 'Operating expenses grew more slowly than revenue, producing an operating margin of 22.1 percent compared with 17.6 percent a year earlier. The Board has recommended a final dividend consistent with the capital allocation policy set out in the 2024 annual report.',
        y: 340,
        height: 78,
        confidence: 0.94,
      },
      {
        type: 'page_number',
        text: 'Page 1 of 3',
        y: 800,
        height: 12,
        confidence: 0.99,
        box: { x: 265, width: 65 },
      },
    ],
  },
  {
    pageNumber: 2,
    chunks: [
      {
        type: 'header',
        text: 'Northwind Analytics · Annual Report 2025',
        y: 34,
        height: 12,
        confidence: 0.97,
      },
      {
        type: 'heading',
        text: 'Financial Results',
        y: 80,
        height: 26,
        confidence: 0.99,
        headingLevel: 2,
      },
      {
        type: 'paragraph',
        text: 'The table below sets out consolidated revenue by region together with the year-over-year change for each segment. Figures are presented in United States dollars and have been prepared on a constant-currency basis.',
        y: 118,
        height: 62,
        confidence: 0.95,
      },
      {
        type: 'caption',
        text: 'Table 1 — Consolidated revenue by region (USD millions)',
        y: 196,
        height: 16,
        confidence: 0.93,
      },
      {
        type: 'table',
        text: 'Region | FY2025 Revenue | FY2024 Revenue | YoY Change\nIndia | 148.2 | 112.4 | +31.9%\nUnited States | 176.9 | 154.1 | +14.8%\nEurope | 94.3 | 82.7 | +14.0%\nAsia-Pacific | 63.2 | 58.3 | +8.4%\nTotal | 482.6 | 407.5 | +18.4%',
        y: 220,
        height: 158,
        confidence: 0.92,
      },
      {
        type: 'paragraph',
        text: 'India remained the fastest-growing region for the third consecutive year, reflecting continued enterprise adoption in the financial services and healthcare verticals. The United States remains the largest single market by absolute revenue.',
        y: 396,
        height: 62,
        confidence: 0.95,
      },
      {
        type: 'page_number',
        text: 'Page 2 of 3',
        y: 800,
        height: 12,
        confidence: 0.99,
        box: { x: 265, width: 65 },
      },
    ],
  },
  {
    pageNumber: 3,
    chunks: [
      {
        type: 'header',
        text: 'Northwind Analytics · Annual Report 2025',
        y: 34,
        height: 12,
        confidence: 0.97,
      },
      {
        type: 'heading',
        text: 'Regional Performance',
        y: 80,
        height: 26,
        confidence: 0.99,
        headingLevel: 2,
      },
      {
        type: 'paragraph',
        text: 'Revenue distribution shifted modestly toward the Asia-Pacific and India segments during the year, while the relative contribution of Europe declined as expected under the segment realignment completed in the first quarter.',
        y: 118,
        height: 62,
        confidence: 0.95,
      },
      {
        type: 'figure',
        text: 'Revenue distribution by region, FY2025',
        y: 196,
        height: 176,
        confidence: 0.9,
      },
      {
        type: 'caption',
        text: 'Figure 1 — Revenue distribution by region, FY2025',
        y: 380,
        height: 16,
        confidence: 0.93,
      },
      {
        type: 'heading',
        text: 'Personnel & Benefits',
        y: 420,
        height: 26,
        confidence: 0.98,
        headingLevel: 2,
      },
      {
        type: 'paragraph',
        text: 'Headcount increased to 2,480 employees at year end. The company offers a comprehensive benefits programme, and the remuneration committee reviews notice periods and termination provisions for senior staff annually.',
        y: 458,
        height: 62,
        confidence: 0.94,
      },
      {
        type: 'list',
        text: 'Comprehensive health and dental coverage for employees and dependants\nEmployer pension contribution of up to 9 percent of base salary\nAnnual leave entitlement of 25 days plus public holidays\nHybrid working allowance and home office equipment budget',
        y: 528,
        height: 88,
        confidence: 0.91,
      },
      {
        type: 'heading',
        text: 'Outlook',
        y: 640,
        height: 26,
        confidence: 0.98,
        headingLevel: 2,
      },
      {
        type: 'paragraph',
        text: 'The Board expects continued revenue growth in the coming year, supported by the Enterprise Data Platform roadmap and further expansion of the partner ecosystem. Macroeconomic conditions remain the principal source of uncertainty.',
        y: 678,
        height: 62,
        confidence: 0.95,
      },
      {
        type: 'page_number',
        text: 'Page 3 of 3',
        y: 800,
        height: 12,
        confidence: 0.99,
        box: { x: 265, width: 65 },
      },
    ],
  },
];

/** Deterministic chunk list in reading order across the whole document. */
export function buildChunks(): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  for (const page of PAGES) {
    page.chunks.forEach((spec, indexOnPage) => {
      const seq = chunks.length + 1;
      chunks.push({
        chunk_id: `chunk_${String(seq).padStart(3, '0')}`,
        text: spec.text,
        page_number: page.pageNumber,
        bounding_box: {
          x: spec.box?.x ?? MARGIN_X,
          y: spec.box?.y ?? spec.y,
          width: spec.box?.width ?? CONTENT_WIDTH,
          height: spec.box?.height ?? spec.height,
        },
        type: spec.type,
        confidence: spec.confidence ?? 0.95,
        ...(spec.headingLevel !== undefined ? { heading_level: spec.headingLevel } : {}),
        ...(spec.type === 'table' ? { group_id: `grp_tbl_${page.pageNumber}_${indexOnPage}` } : {}),
      });
    });
  }
  return chunks;
}

export const PAGE_GEOMETRY = Array.from({ length: PAGES.length }, (_, i) => ({
  pageNumber: i + 1,
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
}));

export const DOCUMENT_TITLE = 'Annual Report 2025';
export const DOCUMENT_AUTHOR = 'Northwind Analytics';
export const DOCUMENT_SUMMARY =
  'Consolidated annual report for FY2025 covering revenue performance across India, the United States, Europe and Asia-Pacific, together with personnel, benefits and outlook disclosures.';

export const FIGURE_ASSET_NAME = 'image-001.svg';
export const FIGURE_CAPTION = 'Revenue distribution by region, FY2025';

/** Deterministic, dependency-free SVG that stands in for an extracted figure. */
export function buildFigureSvg(): string {
  const bars: Array<{ label: string; value: number }> = [
    { label: 'United States', value: 176.9 },
    { label: 'India', value: 148.2 },
    { label: 'Europe', value: 94.3 },
    { label: 'Asia-Pacific', value: 63.2 },
  ];
  const max = Math.max(...bars.map((b) => b.value));

  const rowHeight = 34;
  const top = 56;
  const chartLeft = 150;
  const chartWidth = 300;

  const rows = bars
    .map((bar, i) => {
      const y = top + i * rowHeight;
      const width = Math.round((bar.value / max) * chartWidth);
      return [
        `<text x="20" y="${y + 15}" font-family="Inter, system-ui, sans-serif" font-size="12" fill="#5b5f66">${bar.label}</text>`,
        `<rect x="${chartLeft}" y="${y + 3}" width="${width}" height="18" rx="3" fill="#6e56cf" opacity="${(1 - i * 0.18).toFixed(2)}" />`,
        `<text x="${chartLeft + width + 8}" y="${y + 16}" font-family="Inter, system-ui, sans-serif" font-size="11" fill="#26282c">${bar.value.toFixed(1)}</text>`,
      ].join('');
    })
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 210" width="480" height="210" role="img" aria-label="Revenue distribution by region">`,
    `<rect width="480" height="210" fill="#ffffff" />`,
    `<text x="20" y="30" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="600" fill="#111214">Revenue by region (USD millions)</text>`,
    rows,
    `<line x1="20" y1="196" x2="460" y2="196" stroke="#e6e6ea" stroke-width="1" />`,
    `<text x="20" y="207" font-family="Inter, system-ui, sans-serif" font-size="10" fill="#8b8f96">Source: Northwind Analytics consolidated statements, FY2025</text>`,
    `</svg>`,
  ].join('');
}

/** Secondary representation: the same content as a typed node tree. */
export function buildStructuredDocument(): StructuredDocument {
  const tables: StructuredTable[] = [
    {
      id: 'tbl_001',
      page_number: 2,
      caption: 'Table 1 — Consolidated revenue by region (USD millions)',
      headers: ['Region', 'FY2025 Revenue', 'FY2024 Revenue', 'YoY Change'],
      rows: [
        ['India', '148.2', '112.4', '+31.9%'],
        ['United States', '176.9', '154.1', '+14.8%'],
        ['Europe', '94.3', '82.7', '+14.0%'],
        ['Asia-Pacific', '63.2', '58.3', '+8.4%'],
        ['Total', '482.6', '407.5', '+18.4%'],
      ],
      align: ['left', 'right', 'right', 'right'],
    },
  ];

  const sections: StructuredSection[] = [
    {
      id: 'sec_001',
      level: 2,
      heading: 'Executive Summary',
      page_number: 1,
      paragraphs: [
        'Total revenue for the year reached USD 482.6 million, an increase of 18.4 percent over the prior year. Growth was driven by the Enterprise Data Platform, which now accounts for 41 percent of consolidated revenue and continues to expand its margin profile as delivery scales.',
        'Operating expenses grew more slowly than revenue, producing an operating margin of 22.1 percent compared with 17.6 percent a year earlier. The Board has recommended a final dividend consistent with the capital allocation policy set out in the 2024 annual report.',
      ],
      lists: [],
      table_refs: [],
      asset_refs: [],
    },
    {
      id: 'sec_002',
      level: 2,
      heading: 'Financial Results',
      page_number: 2,
      paragraphs: [
        'The table below sets out consolidated revenue by region together with the year-over-year change for each segment. Figures are presented in United States dollars and have been prepared on a constant-currency basis.',
        'India remained the fastest-growing region for the third consecutive year, reflecting continued enterprise adoption in the financial services and healthcare verticals. The United States remains the largest single market by absolute revenue.',
      ],
      lists: [],
      table_refs: ['tbl_001'],
      asset_refs: [],
    },
    {
      id: 'sec_003',
      level: 2,
      heading: 'Regional Performance',
      page_number: 3,
      paragraphs: [
        'Revenue distribution shifted modestly toward the Asia-Pacific and India segments during the year, while the relative contribution of Europe declined as expected under the segment realignment completed in the first quarter.',
      ],
      lists: [],
      table_refs: [],
      asset_refs: [FIGURE_ASSET_NAME],
    },
    {
      id: 'sec_004',
      level: 2,
      heading: 'Personnel & Benefits',
      page_number: 3,
      paragraphs: [
        'Headcount increased to 2,480 employees at year end. The company offers a comprehensive benefits programme, and the remuneration committee reviews notice periods and termination provisions for senior staff annually.',
      ],
      lists: [
        [
          'Comprehensive health and dental coverage for employees and dependants',
          'Employer pension contribution of up to 9 percent of base salary',
          'Annual leave entitlement of 25 days plus public holidays',
          'Hybrid working allowance and home office equipment budget',
        ],
      ],
      table_refs: [],
      asset_refs: [],
    },
    {
      id: 'sec_005',
      level: 2,
      heading: 'Outlook',
      page_number: 3,
      paragraphs: [
        'The Board expects continued revenue growth in the coming year, supported by the Enterprise Data Platform roadmap and further expansion of the partner ecosystem. Macroeconomic conditions remain the principal source of uncertainty.',
      ],
      lists: [],
      table_refs: [],
      asset_refs: [],
    },
  ];

  return {
    title: DOCUMENT_TITLE,
    page_count: PAGES.length,
    sections,
    tables,
    assets: [FIGURE_ASSET_NAME],
  };
}
