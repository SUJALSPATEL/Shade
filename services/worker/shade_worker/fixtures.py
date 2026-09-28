"""The canonical mocked document.

A faithful port of two TypeScript files:

* ``packages/shared/src/mock/fixture-document.ts`` — the page geometry, the
  positioned chunk specs, the figure SVG and the structured node tree.
* the fixture data of ``packages/shared/src/mock/engine.ts`` — ``PRESET_SCHEMAS``
  and the shared ``metadata()`` helper.

Everything the processing plane produces in this milestone derives from this one
fixture, so a user who parses the document, extracts from it and searches it sees
one coherent story rather than three unrelated placeholder payloads. When a real
engine lands, this module is deleted; nothing outside ``processors/`` imports it
directly except the JS-number helpers below.

The chunk ids, the text, the coordinates, the SVG markup and the Markdown are all
byte-for-byte what the API's own mock engine emits, which is what makes the
inline dispatcher and the Python worker interchangeable during development.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Mapping, Sequence

from .models import (
    BoundingBox,
    ChunkType,
    DocumentChunk,
    ProcessorMetadata,
    SchemaField,
    StructuredDocument,
    StructuredSection,
    StructuredTable,
)

# ── JS numeric fidelity ─────────────────────────────────────────────────────


def js_round(value: float) -> int:
    """``Math.round`` — half-way cases go *up*, unlike Python's ``round``.

    Python's builtin uses banker's rounding (``round(0.5) == 0``), which would
    silently disagree with the TypeScript engine on tie values. Ported SVG bar
    widths must match the API's byte for byte, so the JS rule is reproduced
    explicitly rather than left to chance.
    """
    return int(Decimal(value).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def to_fixed(value: float, digits: int) -> float:
    """``Number(x.toFixed(digits))``.

    The ECMAScript specification picks the integer ``n`` for which
    ``n / 10**digits - x`` is closest to zero and, on a tie, the larger one —
    that is round-half-away-from-zero applied to the *exact binary* value.
    ``Decimal(value)`` is exact, and ``ROUND_HALF_UP`` is the same rule, so this
    reproduces ``toFixed`` exactly where ``round()`` would not.
    """
    exponent = Decimal(1).scaleb(-digits)
    return float(Decimal(value).quantize(exponent, rounding=ROUND_HALF_UP))


def to_fixed_str(value: float, digits: int) -> str:
    """``x.toFixed(digits)`` as a string (used by the SVG generator)."""
    exponent = Decimal(1).scaleb(-digits)
    return str(Decimal(value).quantize(exponent, rounding=ROUND_HALF_UP))


# ── Page geometry ───────────────────────────────────────────────────────────

#: A4 in PDF points. Chunk coordinates are relative to this page box.
PAGE_WIDTH = 595
PAGE_HEIGHT = 842

MARGIN_X = 64
CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2

DOCUMENT_TITLE = "Annual Report 2025"
DOCUMENT_AUTHOR = "Northwind Analytics"
DOCUMENT_SUMMARY = (
    "Consolidated annual report for FY2025 covering revenue performance across "
    "India, the United States, Europe and Asia-Pacific, together with personnel, "
    "benefits and outlook disclosures."
)

FIGURE_ASSET_NAME = "image-001.svg"
FIGURE_CAPTION = "Revenue distribution by region, FY2025"

#: The asset directory the Markdown generator links against. The link is
#: relative so it resolves against the directory holding ``document.md``.
ASSET_DIR = "assets"


@dataclass(frozen=True, slots=True)
class ChunkSpec:
    """One positioned region definition, as declared in the TS ``ChunkSpec``."""

    type: ChunkType
    text: str
    y: int
    height: int
    confidence: float = 0.95
    heading_level: int | None = None
    #: Overrides the default full-content-width box.
    box: Mapping[str, int] | None = None


@dataclass(frozen=True, slots=True)
class PageSpec:
    page_number: int
    chunks: tuple[ChunkSpec, ...]


#: Positioned region definitions, grouped by page, in reading order.
PAGES: tuple[PageSpec, ...] = (
    PageSpec(
        page_number=1,
        chunks=(
            ChunkSpec(
                type="header",
                text="Northwind Analytics · Annual Report 2025",
                y=34,
                height=12,
                confidence=0.97,
            ),
            ChunkSpec(
                type="heading",
                text="Annual Report 2025",
                y=80,
                height=36,
                confidence=0.99,
                heading_level=1,
            ),
            ChunkSpec(
                type="paragraph",
                text=(
                    "Northwind Analytics is pleased to present its consolidated "
                    "results for the fiscal year ended 31 December 2025. Revenue "
                    "grew across every operating region, with the strongest "
                    "expansion in the Asia-Pacific segment."
                ),
                y=130,
                height=62,
                confidence=0.96,
            ),
            ChunkSpec(
                type="heading",
                text="Executive Summary",
                y=212,
                height=26,
                confidence=0.99,
                heading_level=2,
            ),
            ChunkSpec(
                type="paragraph",
                text=(
                    "Total revenue for the year reached USD 482.6 million, an "
                    "increase of 18.4 percent over the prior year. Growth was "
                    "driven by the Enterprise Data Platform, which now accounts "
                    "for 41 percent of consolidated revenue and continues to "
                    "expand its margin profile as delivery scales."
                ),
                y=250,
                height=78,
                confidence=0.95,
            ),
            ChunkSpec(
                type="paragraph",
                text=(
                    "Operating expenses grew more slowly than revenue, producing "
                    "an operating margin of 22.1 percent compared with 17.6 "
                    "percent a year earlier. The Board has recommended a final "
                    "dividend consistent with the capital allocation policy set "
                    "out in the 2024 annual report."
                ),
                y=340,
                height=78,
                confidence=0.94,
            ),
            ChunkSpec(
                type="page_number",
                text="Page 1 of 3",
                y=800,
                height=12,
                confidence=0.99,
                box={"x": 265, "width": 65},
            ),
        ),
    ),
    PageSpec(
        page_number=2,
        chunks=(
            ChunkSpec(
                type="header",
                text="Northwind Analytics · Annual Report 2025",
                y=34,
                height=12,
                confidence=0.97,
            ),
            ChunkSpec(
                type="heading",
                text="Financial Results",
                y=80,
                height=26,
                confidence=0.99,
                heading_level=2,
            ),
            ChunkSpec(
                type="paragraph",
                text=(
                    "The table below sets out consolidated revenue by region "
                    "together with the year-over-year change for each segment. "
                    "Figures are presented in United States dollars and have been "
                    "prepared on a constant-currency basis."
                ),
                y=118,
                height=62,
                confidence=0.95,
            ),
            ChunkSpec(
                type="caption",
                text="Table 1 — Consolidated revenue by region (USD millions)",
                y=196,
                height=16,
                confidence=0.93,
            ),
            ChunkSpec(
                type="table",
                text=(
                    "Region | FY2025 Revenue | FY2024 Revenue | YoY Change\n"
                    "India | 148.2 | 112.4 | +31.9%\n"
                    "United States | 176.9 | 154.1 | +14.8%\n"
                    "Europe | 94.3 | 82.7 | +14.0%\n"
                    "Asia-Pacific | 63.2 | 58.3 | +8.4%\n"
                    "Total | 482.6 | 407.5 | +18.4%"
                ),
                y=220,
                height=158,
                confidence=0.92,
            ),
            ChunkSpec(
                type="paragraph",
                text=(
                    "India remained the fastest-growing region for the third "
                    "consecutive year, reflecting continued enterprise adoption in "
                    "the financial services and healthcare verticals. The United "
                    "States remains the largest single market by absolute revenue."
                ),
                y=396,
                height=62,
                confidence=0.95,
            ),
            ChunkSpec(
                type="page_number",
                text="Page 2 of 3",
                y=800,
                height=12,
                confidence=0.99,
                box={"x": 265, "width": 65},
            ),
        ),
    ),
    PageSpec(
        page_number=3,
        chunks=(
            ChunkSpec(
                type="header",
                text="Northwind Analytics · Annual Report 2025",
                y=34,
                height=12,
                confidence=0.97,
            ),
            ChunkSpec(
                type="heading",
                text="Regional Performance",
                y=80,
                height=26,
                confidence=0.99,
                heading_level=2,
            ),
            ChunkSpec(
                type="paragraph",
                text=(
                    "Revenue distribution shifted modestly toward the "
                    "Asia-Pacific and India segments during the year, while the "
                    "relative contribution of Europe declined as expected under "
                    "the segment realignment completed in the first quarter."
                ),
                y=118,
                height=62,
                confidence=0.95,
            ),
            ChunkSpec(
                type="figure",
                text="Revenue distribution by region, FY2025",
                y=196,
                height=176,
                confidence=0.9,
            ),
            ChunkSpec(
                type="caption",
                text="Figure 1 — Revenue distribution by region, FY2025",
                y=380,
                height=16,
                confidence=0.93,
            ),
            ChunkSpec(
                type="heading",
                text="Personnel & Benefits",
                y=420,
                height=26,
                confidence=0.98,
                heading_level=2,
            ),
            ChunkSpec(
                type="paragraph",
                text=(
                    "Headcount increased to 2,480 employees at year end. The "
                    "company offers a comprehensive benefits programme, and the "
                    "remuneration committee reviews notice periods and termination "
                    "provisions for senior staff annually."
                ),
                y=458,
                height=62,
                confidence=0.94,
            ),
            ChunkSpec(
                type="list",
                text=(
                    "Comprehensive health and dental coverage for employees and "
                    "dependants\n"
                    "Employer pension contribution of up to 9 percent of base "
                    "salary\n"
                    "Annual leave entitlement of 25 days plus public holidays\n"
                    "Hybrid working allowance and home office equipment budget"
                ),
                y=528,
                height=88,
                confidence=0.91,
            ),
            ChunkSpec(
                type="heading",
                text="Outlook",
                y=640,
                height=26,
                confidence=0.98,
                heading_level=2,
            ),
            ChunkSpec(
                type="paragraph",
                text=(
                    "The Board expects continued revenue growth in the coming "
                    "year, supported by the Enterprise Data Platform roadmap and "
                    "further expansion of the partner ecosystem. Macroeconomic "
                    "conditions remain the principal source of uncertainty."
                ),
                y=678,
                height=62,
                confidence=0.95,
            ),
            ChunkSpec(
                type="page_number",
                text="Page 3 of 3",
                y=800,
                height=12,
                confidence=0.99,
                box={"x": 265, "width": 65},
            ),
        ),
    ),
)

#: Number of positioned regions in reading order — asserted by the test suite.
CHUNK_COUNT = sum(len(page.chunks) for page in PAGES)


# ── Chunks ──────────────────────────────────────────────────────────────────


def build_chunks() -> list[DocumentChunk]:
    """Deterministic chunk list in reading order across the whole document.

    ``group_id`` is spread in only for tables, and ``heading_level`` only when
    the spec declares one — mirroring the conditional spreads in the TS builder
    so the serialised JSON omits exactly the same keys.
    """
    chunks: list[DocumentChunk] = []
    for page in PAGES:
        for index_on_page, spec in enumerate(page.chunks):
            seq = len(chunks) + 1
            box = spec.box or {}
            kwargs: dict[str, Any] = {}
            if spec.heading_level is not None:
                kwargs["heading_level"] = spec.heading_level
            if spec.type == "table":
                kwargs["group_id"] = f"grp_tbl_{page.page_number}_{index_on_page}"
            chunks.append(
                DocumentChunk(
                    chunk_id=f"chunk_{seq:03d}",
                    text=spec.text,
                    page_number=page.page_number,
                    bounding_box=BoundingBox(
                        x=box.get("x", MARGIN_X),
                        y=box.get("y", spec.y),
                        width=box.get("width", CONTENT_WIDTH),
                        height=box.get("height", spec.height),
                    ),
                    type=spec.type,
                    confidence=spec.confidence,
                    **kwargs,
                )
            )
    return chunks


#: Page boxes, in page order. Drives ``pageCount`` on every result.
PAGE_GEOMETRY: tuple[Mapping[str, int], ...] = tuple(
    {
        "pageNumber": index + 1,
        "width": PAGE_WIDTH,
        "height": PAGE_HEIGHT,
    }
    for index in range(len(PAGES))
)


# ── Figure asset ────────────────────────────────────────────────────────────


def build_figure_svg() -> str:
    """Deterministic, dependency-free SVG that stands in for an extracted figure.

    Every number that reaches the markup goes through :func:`js_round` or
    :func:`to_fixed_str`, so the bytes match the TypeScript generator exactly.
    """
    bars: tuple[tuple[str, float], ...] = (
        ("United States", 176.9),
        ("India", 148.2),
        ("Europe", 94.3),
        ("Asia-Pacific", 63.2),
    )
    largest = max(value for _, value in bars)

    row_height = 34
    top = 56
    chart_left = 150
    chart_width = 300

    rows = "".join(
        "".join(
            (
                f'<text x="20" y="{top + index * row_height + 15}" '
                f'font-family="Inter, system-ui, sans-serif" font-size="12" '
                f'fill="#5b5f66">{label}</text>',
                f'<rect x="{chart_left}" y="{top + index * row_height + 3}" '
                f'width="{js_round(value / largest * chart_width)}" height="18" '
                f'rx="3" fill="#6e56cf" opacity="{to_fixed_str(1 - index * 0.18, 2)}" />',
                f'<text x="{chart_left + js_round(value / largest * chart_width) + 8}" '
                f'y="{top + index * row_height + 16}" '
                f'font-family="Inter, system-ui, sans-serif" font-size="11" '
                f'fill="#26282c">{to_fixed_str(value, 1)}</text>',
            )
        )
        for index, (label, value) in enumerate(bars)
    )

    return "".join(
        (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 210" '
            'width="480" height="210" role="img" '
            'aria-label="Revenue distribution by region">',
            '<rect width="480" height="210" fill="#ffffff" />',
            '<text x="20" y="30" font-family="Inter, system-ui, sans-serif" '
            'font-size="13" font-weight="600" fill="#111214">'
            "Revenue by region (USD millions)</text>",
            rows,
            '<line x1="20" y1="196" x2="460" y2="196" stroke="#e6e6ea" '
            'stroke-width="1" />',
            '<text x="20" y="207" font-family="Inter, system-ui, sans-serif" '
            'font-size="10" fill="#8b8f96">'
            "Source: Northwind Analytics consolidated statements, FY2025</text>",
            "</svg>",
        )
    )


# ── Structured document ─────────────────────────────────────────────────────


def build_structured_document() -> StructuredDocument:
    """Secondary representation: the same content as a typed node tree."""
    tables = [
        StructuredTable(
            id="tbl_001",
            page_number=2,
            caption="Table 1 — Consolidated revenue by region (USD millions)",
            headers=["Region", "FY2025 Revenue", "FY2024 Revenue", "YoY Change"],
            rows=[
                ["India", "148.2", "112.4", "+31.9%"],
                ["United States", "176.9", "154.1", "+14.8%"],
                ["Europe", "94.3", "82.7", "+14.0%"],
                ["Asia-Pacific", "63.2", "58.3", "+8.4%"],
                ["Total", "482.6", "407.5", "+18.4%"],
            ],
            align=["left", "right", "right", "right"],
        )
    ]

    sections = [
        StructuredSection(
            id="sec_001",
            level=2,
            heading="Executive Summary",
            page_number=1,
            paragraphs=[
                "Total revenue for the year reached USD 482.6 million, an increase "
                "of 18.4 percent over the prior year. Growth was driven by the "
                "Enterprise Data Platform, which now accounts for 41 percent of "
                "consolidated revenue and continues to expand its margin profile "
                "as delivery scales.",
                "Operating expenses grew more slowly than revenue, producing an "
                "operating margin of 22.1 percent compared with 17.6 percent a "
                "year earlier. The Board has recommended a final dividend "
                "consistent with the capital allocation policy set out in the "
                "2024 annual report.",
            ],
            lists=[],
            table_refs=[],
            asset_refs=[],
        ),
        StructuredSection(
            id="sec_002",
            level=2,
            heading="Financial Results",
            page_number=2,
            paragraphs=[
                "The table below sets out consolidated revenue by region together "
                "with the year-over-year change for each segment. Figures are "
                "presented in United States dollars and have been prepared on a "
                "constant-currency basis.",
                "India remained the fastest-growing region for the third "
                "consecutive year, reflecting continued enterprise adoption in the "
                "financial services and healthcare verticals. The United States "
                "remains the largest single market by absolute revenue.",
            ],
            lists=[],
            table_refs=["tbl_001"],
            asset_refs=[],
        ),
        StructuredSection(
            id="sec_003",
            level=2,
            heading="Regional Performance",
            page_number=3,
            paragraphs=[
                "Revenue distribution shifted modestly toward the Asia-Pacific and "
                "India segments during the year, while the relative contribution "
                "of Europe declined as expected under the segment realignment "
                "completed in the first quarter.",
            ],
            lists=[],
            table_refs=[],
            asset_refs=[FIGURE_ASSET_NAME],
        ),
        StructuredSection(
            id="sec_004",
            level=2,
            heading="Personnel & Benefits",
            page_number=3,
            paragraphs=[
                "Headcount increased to 2,480 employees at year end. The company "
                "offers a comprehensive benefits programme, and the remuneration "
                "committee reviews notice periods and termination provisions for "
                "senior staff annually.",
            ],
            lists=[
                [
                    "Comprehensive health and dental coverage for employees and dependants",
                    "Employer pension contribution of up to 9 percent of base salary",
                    "Annual leave entitlement of 25 days plus public holidays",
                    "Hybrid working allowance and home office equipment budget",
                ]
            ],
            table_refs=[],
            asset_refs=[],
        ),
        StructuredSection(
            id="sec_005",
            level=2,
            heading="Outlook",
            page_number=3,
            paragraphs=[
                "The Board expects continued revenue growth in the coming year, "
                "supported by the Enterprise Data Platform roadmap and further "
                "expansion of the partner ecosystem. Macroeconomic conditions "
                "remain the principal source of uncertainty.",
            ],
            lists=[],
            table_refs=[],
            asset_refs=[],
        ),
    ]

    return StructuredDocument(
        title=DOCUMENT_TITLE,
        page_count=len(PAGES),
        sections=sections,
        tables=tables,
        assets=[FIGURE_ASSET_NAME],
    )


# ── Processor metadata ──────────────────────────────────────────────────────


def iso_timestamp(epoch_ms: float) -> str:
    """``new Date(ms).toISOString()`` — UTC, millisecond precision, ``Z`` suffix."""
    seconds, millis = divmod(int(epoch_ms), 1000)
    moment = datetime.fromtimestamp(seconds, tz=timezone.utc)
    return f"{moment.strftime('%Y-%m-%dT%H:%M:%S')}.{millis:03d}Z"


def build_metadata(
    *,
    engine: str,
    version: str,
    started_at_ms: int,
    duration_ms: int,
    mocked: bool,
) -> ProcessorMetadata:
    """Mirrors ``metadata()`` in engine.ts.

    ``durationMs`` is passed in rather than measured because the mock engine
    reports a small fixed cost per operation, which keeps durations plausible
    without making tests slow — and keeps the output fully deterministic.
    """
    return ProcessorMetadata(
        engine=engine,
        version=version,
        duration_ms=max(1, duration_ms),
        processed_at=iso_timestamp(started_at_ms + duration_ms),
        mocked=mocked,
    )


# ── Preset extraction schemas ───────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class PresetSchema:
    id: str
    name: str
    description: str
    fields: tuple[SchemaField, ...]


def _field(
    name: str,
    type_: str,
    description: str | None = None,
    required: bool | None = None,
) -> SchemaField:
    """Build a :class:`SchemaField` with only the declared keys set.

    ``description`` / ``required`` are left unset when not supplied so the wire
    form matches the TS literal, which omits them entirely.
    """
    kwargs: dict[str, Any] = {"name": name, "type": type_}
    if description is not None:
        kwargs["description"] = description
    if required is not None:
        kwargs["required"] = required
    return SchemaField(**kwargs)


#: Starter schemas surfaced in the Extract schema builder. They are the fastest
#: path to a meaningful extraction result for a first-time user, and they double
#: as documentation of the supported field vocabulary.
PRESET_SCHEMAS: tuple[PresetSchema, ...] = (
    PresetSchema(
        id="financial_summary",
        name="Financial summary",
        description="Headline revenue figures and year-over-year movement.",
        fields=(
            _field("company_name", "string", "Reporting entity", required=True),
            _field("reporting_period", "string", "Fiscal period covered", required=True),
            _field("total_revenue", "number", "Consolidated revenue", required=True),
            _field("revenue_growth_pct", "number", "Year-over-year change", required=False),
            _field("operating_margin_pct", "number", "Operating margin", required=False),
            _field("regions", "array<object>", "Revenue broken out by region", required=False),
        ),
    ),
    PresetSchema(
        id="education_history",
        name="Education history",
        description="Degrees and institutions, as used for candidate documents.",
        fields=(
            _field("institution_name", "string", required=True),
            _field("degree_program", "string", required=True),
            _field("location", "string", required=False),
            _field("start_date", "date", required=False),
            _field("end_date", "date", required=False),
        ),
    ),
    PresetSchema(
        id="contract_terms",
        name="Contract terms",
        description="Parties, term and termination provisions.",
        fields=(
            _field("party_a", "string", required=True),
            _field("party_b", "string", required=True),
            _field("effective_date", "date", required=False),
            _field("notice_period_days", "number", required=False),
            _field("termination_clauses", "array<string>", required=False),
            _field("governing_law", "string", required=False),
        ),
    ),
)


def build_schema_from_preset(preset: PresetSchema) -> Mapping[str, Any]:
    """Mirrors ``buildSchemaFromPreset`` — used by the API's seed path."""
    epoch = iso_timestamp(0)
    return {
        "id": f"sch_{preset.id}",
        "name": preset.name,
        "description": preset.description,
        "fields": list(preset.fields),
        "createdAt": epoch,
        "updatedAt": epoch,
    }


#: Reverse lookup so the Extract processor can resolve a schema by name when a
#: job carries only a name.
PRESET_SCHEMAS_BY_NAME: Mapping[str, PresetSchema] = {
    preset.name: preset for preset in PRESET_SCHEMAS
}

__all__ = [
    "ASSET_DIR",
    "CHUNK_COUNT",
    "DOCUMENT_AUTHOR",
    "DOCUMENT_SUMMARY",
    "DOCUMENT_TITLE",
    "FIGURE_ASSET_NAME",
    "FIGURE_CAPTION",
    "MARGIN_X",
    "PAGES",
    "PAGE_GEOMETRY",
    "PAGE_HEIGHT",
    "PAGE_WIDTH",
    "PRESET_SCHEMAS",
    "PRESET_SCHEMAS_BY_NAME",
    "PresetSchema",
    "build_chunks",
    "build_figure_svg",
    "build_metadata",
    "build_schema_from_preset",
    "build_structured_document",
    "iso_timestamp",
    "js_round",
    "to_fixed",
    "to_fixed_str",
]
