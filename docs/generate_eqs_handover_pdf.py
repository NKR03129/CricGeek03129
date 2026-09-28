#!/usr/bin/env python3
"""
Generates docs/CricGeek_EQS_Implementation_Handover.pdf

    python docs/generate_eqs_handover_pdf.py

A self-contained technical handover: what the project is, how EQS works, what was
built, and how to test all of it. Requires reportlab (`pip install reportlab`).

Font note: the built-in Type-1 fonts use WinAnsi encoding, which has no glyphs for
arrows, check marks, or Unicode sub/superscripts. Those render as black boxes, so this
document deliberately sticks to ASCII plus the en/em dash and bullet.
"""

from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

# ── Palette ──────────────────────────────────────────────────────────
NAVY = colors.HexColor("#1F2A44")
NAVY_LIGHT = colors.HexColor("#33415C")
GREEN = colors.HexColor("#1E6F4C")
AMBER = colors.HexColor("#8A5A00")
RED = colors.HexColor("#9B2C2C")
GREY = colors.HexColor("#5A6270")
RULE = colors.HexColor("#D4D9E0")
BAND = colors.HexColor("#EEF1F5")
CODE_BG = colors.HexColor("#F4F6F8")

OUTPUT = "docs/CricGeek_EQS_Implementation_Handover.pdf"
TODAY = date.today().strftime("%d %B %Y")

# ── Styles ───────────────────────────────────────────────────────────
ss = getSampleStyleSheet()


def style(name, **kw):
    base = kw.pop("parent", ss["BodyText"])
    return ParagraphStyle(name, parent=base, **kw)


S = {
    "title": style("t", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=30,
                   leading=35, textColor=NAVY, spaceAfter=4),
    "subtitle": style("st", fontName="Helvetica", fontSize=13.5, leading=19,
                      textColor=NAVY_LIGHT, alignment=TA_CENTER, spaceAfter=6),
    "tagline": style("tg", fontName="Helvetica-Oblique", fontSize=10.5, leading=16,
                     textColor=GREY, alignment=TA_CENTER),
    "part": style("p", fontName="Helvetica-Bold", fontSize=20, leading=24,
                  textColor=colors.white, spaceBefore=0, spaceAfter=0),
    "h1": style("h1", fontName="Helvetica-Bold", fontSize=15.5, leading=19,
                textColor=NAVY, spaceBefore=16, spaceAfter=7),
    "h2": style("h2", fontName="Helvetica-Bold", fontSize=12, leading=15,
                textColor=NAVY_LIGHT, spaceBefore=12, spaceAfter=5),
    "h3": style("h3", fontName="Helvetica-BoldOblique", fontSize=10.5, leading=14,
                textColor=GREEN, spaceBefore=9, spaceAfter=3),
    "body": style("b", fontName="Helvetica", fontSize=9.6, leading=14.2,
                  textColor=colors.HexColor("#22272E"), alignment=TA_JUSTIFY,
                  spaceAfter=6),
    "bullet": style("bu", fontName="Helvetica", fontSize=9.4, leading=13.6,
                    textColor=colors.HexColor("#22272E"), leftIndent=13,
                    bulletIndent=3, spaceAfter=3.5),
    "num": style("nu", fontName="Helvetica", fontSize=9.4, leading=13.6,
                 textColor=colors.HexColor("#22272E"), leftIndent=17,
                 bulletIndent=3, spaceAfter=3.5),
    "code": style("c", fontName="Courier", fontSize=8.2, leading=11.4,
                  textColor=colors.HexColor("#14181F"), alignment=TA_LEFT),
    "cap": style("cp", fontName="Helvetica-Oblique", fontSize=8.3, leading=11.5,
                 textColor=GREY, spaceAfter=8, spaceBefore=2),
    "th": style("th", fontName="Helvetica-Bold", fontSize=8.4, leading=11,
                textColor=colors.white),
    "td": style("td", fontName="Helvetica", fontSize=8.3, leading=11.3,
                textColor=colors.HexColor("#22272E")),
    "tdb": style("tdb", fontName="Helvetica-Bold", fontSize=8.3, leading=11.3,
                 textColor=NAVY),
    "tdm": style("tdm", fontName="Courier", fontSize=7.7, leading=10.6,
                 textColor=colors.HexColor("#14181F")),
    "toc": style("toc", fontName="Helvetica", fontSize=9.5, leading=15.5,
                 textColor=colors.HexColor("#22272E")),
    "tocp": style("tocp", fontName="Helvetica-Bold", fontSize=10, leading=17,
                  textColor=NAVY, spaceBefore=7),
}

story = []


# ── Building blocks ──────────────────────────────────────────────────
def para(text, key="body"):
    story.append(Paragraph(text, S[key]))


def h1(text):
    story.append(Paragraph(text, S["h1"]))


def h2(text):
    story.append(Paragraph(text, S["h2"]))


def h3(text):
    story.append(Paragraph(text, S["h3"]))


def gap(h=6):
    story.append(Spacer(1, h))


def bullets(items, style_key="bullet"):
    for it in items:
        story.append(Paragraph(it, S[style_key], bulletText="•"))
    gap(4)


def numbered(items, start=1):
    for i, it in enumerate(items, start):
        story.append(Paragraph(it, S["num"], bulletText=f"{i}."))
    gap(4)


def part_banner(number, title, blurb):
    """Full-width coloured band introducing a part of the document."""
    inner = [
        [Paragraph(f"PART {number}", S["th"])],
        [Paragraph(title, S["part"])],
    ]
    t = Table(inner, colWidths=[WIDTH])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (0, 0), 11),
        ("BOTTOMPADDING", (0, 0), (0, 0), 1),
        ("TOPPADDING", (0, 1), (0, 1), 0),
        ("BOTTOMPADDING", (0, 1), (0, 1), 12),
    ]))
    story.append(t)
    if blurb:
        story.append(Paragraph(blurb, S["cap"]))
    gap(4)


def code(lines, bg=CODE_BG):
    """Monospace block. `lines` is a string or list of strings."""
    if isinstance(lines, str):
        lines = lines.split("\n")
    body = "<br/>".join(
        l.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
         .replace(" ", "&nbsp;") or "&nbsp;"
        for l in lines
    )
    t = Table([[Paragraph(body, S["code"])]], colWidths=[WIDTH])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(t)
    gap(8)


def table(header, rows, widths, mono_cols=(), bold_cols=(), caption=None,
          align_right=(), font_scale=1.0, nowrap_cols=()):
    """
    Header + body table. Cells are Paragraphs so they wrap.

    Pass `header=None` for a headerless key/value table.
    `nowrap_cols` keeps short values (numbers, codes) on one line.
    """
    def cell(text, col):
        if col in mono_cols:
            k = "tdm"
        elif col in bold_cols:
            k = "tdb"
        else:
            k = "td"
        st = S[k]
        if font_scale != 1.0:
            st = ParagraphStyle(f"{k}s", parent=st,
                                fontSize=st.fontSize * font_scale,
                                leading=st.leading * font_scale)
        if col in nowrap_cols:
            # Non-breaking content keeps values like "10" off a second line.
            return Paragraph(str(text).replace(" ", "&nbsp;"), st)
        return Paragraph(str(text), st)

    data = []
    has_header = header is not None
    if has_header:
        data.append([Paragraph(h, S["th"]) for h in header])
    for r in rows:
        data.append([cell(c, i) for i, c in enumerate(r)])

    total = sum(widths)
    cols = [w / total * WIDTH for w in widths]

    first_body = 1 if has_header else 0
    t = Table(data, colWidths=cols, repeatRows=first_body)
    st = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if has_header:
        st.append(("BACKGROUND", (0, 0), (-1, 0), NAVY))
    for i in range(first_body, len(data)):
        if (i - first_body) % 2 == 1:
            st.append(("BACKGROUND", (0, i), (-1, i), BAND))
    for c in align_right:
        st.append(("ALIGN", (c, first_body), (c, -1), "RIGHT"))
    t.setStyle(TableStyle(st))
    story.append(t)
    if caption:
        story.append(Paragraph(caption, S["cap"]))
    else:
        gap(9)


def callout(title, body, colour=AMBER):
    """Left-ruled highlight box for warnings and key rules."""
    inner = [[Paragraph(f"<b>{title}</b>", S["td"])], [Paragraph(body, S["td"])]]
    it = Table(inner, colWidths=[WIDTH - 16])
    it.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (0, 0), 0),
        ("BOTTOMPADDING", (0, 0), (0, 0), 3),
        ("TOPPADDING", (0, 1), (0, 1), 0),
        ("BOTTOMPADDING", (0, 1), (0, 1), 0),
    ]))
    t = Table([[it]], colWidths=[WIDTH])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FBF7EE")),
        ("LINEBEFORE", (0, 0), (0, -1), 2.6, colour),
        ("BOX", (0, 0), (-1, -1), 0.4, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(KeepTogether(t))
    gap(9)


# ── Document shell ───────────────────────────────────────────────────
PAGE_W, PAGE_H = A4
LM = RM = 1.9 * cm
TM = 1.9 * cm
BM = 1.9 * cm
WIDTH = PAGE_W - LM - RM


class Doc(BaseDocTemplate):
    def __init__(self, filename, **kw):
        super().__init__(filename, pagesize=A4,
                         leftMargin=LM, rightMargin=RM,
                         topMargin=TM, bottomMargin=BM, **kw)
        frame = Frame(LM, BM, WIDTH, PAGE_H - TM - BM, id="main",
                      leftPadding=0, rightPadding=0,
                      topPadding=0, bottomPadding=0)
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[frame]),
            PageTemplate(id="body", frames=[frame], onPage=decorate),
        ])


def decorate(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.4)
    canvas.setFillColor(GREY)
    canvas.drawString(LM, BM - 11 * mm,
                      "CricGeek Network LLP  |  EQS Implementation & Technical Handover")
    canvas.drawRightString(PAGE_W - RM, BM - 11 * mm, f"Page {doc.page}")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(LM, BM - 7.5 * mm, PAGE_W - RM, BM - 7.5 * mm)
    canvas.restoreState()


# =====================================================================
# COVER
# =====================================================================
gap(58)
para("CRICGEEK", "subtitle")
story.append(Paragraph("Expression Quality Score", S["title"]))
gap(4)
para("Implementation &amp; Technical Handover", "subtitle")
gap(10)
para("A complete account of the EQS content-quality system, the Voice-to-Commentary "
     "workstream, and the database design &mdash; what the project is, what was built, "
     "and how to test every part of it.", "tagline")
gap(30)

table(
    None,
    [
        ["Document", "EQS Implementation &amp; Technical Handover"],
        ["Product", "CricGeek Network LLP"],
        ["Covers", "EQS pipeline, Voice-to-Commentary, database design, testing guide"],
        ["Status", "Implemented &mdash; verified by typecheck, lint, and an offline self-test"],
        ["Codebase", "cricgeek-app (Next.js 16 / TypeScript / Prisma / SQL Server)"],
        ["Pipeline version", "eqs-pipeline-2.0.0"],
        ["Config version", "eqs-config-2026.09.1"],
        ["Schema version", "eqs-schema-1.0.0"],
        ["Generated", TODAY],
    ],
    widths=[26, 74], bold_cols=(0,),
)

gap(18)
callout(
    "Read this first if you are new to the project",
    "Part 1 explains what CricGeek is and why EQS exists. Part 6 is the testing guide "
    "and is written so it can be followed without reading anything else. "
    "For installing and running the app, see <font face='Courier' size='8'>SETUP.md</font> "
    "in the repository root &mdash; it is a copy-paste cheat sheet that assumes no prior "
    "knowledge of the codebase.",
    GREEN,
)

# The cover has no header or footer; every page after it does.
story.append(NextPageTemplate("body"))
story.append(PageBreak())

# =====================================================================
# CONTENTS
# =====================================================================
h1("Contents")

toc = [
    ("PART 1", "The Project"),
    ("1", "What CricGeek is"),
    ("2", "Why EQS exists"),
    ("3", "System architecture"),
    ("4", "How an expression flows through the system"),
    ("PART 2", "The EQS System"),
    ("5", "What EQS is, and what it is not"),
    ("6", "Core principles, and where each is enforced"),
    ("7", "The eleven-stage pipeline"),
    ("8", "The thirteen evaluation dimensions"),
    ("9", "Writer DNA and mixed profiles"),
    ("10", "Final scoring methodology"),
    ("11", "Deterministic guardrails"),
    ("12", "Confidence and human review"),
    ("13", "The three specialist systems"),
    ("14", "Structured intermediate results"),
    ("15", "Model configuration"),
    ("PART 3", "Voice-to-Commentary"),
    ("16", "Pipeline and latency budget"),
    ("17", "Streaming speech-to-text"),
    ("PART 4", "Database Design"),
    ("18", "Tables, indexes, and retention"),
    ("PART 5", "What Was Built"),
    ("19", "Build-breaking bugs that were fixed"),
    ("20", "Bugs found by the self-test"),
    ("21", "Backend defects found and fixed"),
    ("22", "Complete file inventory"),
    ("PART 6", "Testing Guide"),
    ("23", "Test levels at a glance"),
    ("24", "Level 0 - Verify the install"),
    ("25", "Level 1 - Offline self-test (no keys needed)"),
    ("26", "Level 2 - Typecheck, lint, build"),
    ("27", "Level 3 - The health endpoint"),
    ("28", "Level 4 - API smoke tests"),
    ("29", "Level 5 - Behavioural tests of the principles"),
    ("30", "Level 6 - Benchmark and calibration"),
    ("31", "Level 7 - Database verification"),
    ("32", "Level 8 - Voice-to-Commentary"),
    ("33", "Regression checklist"),
    ("PART 7", "Caveats and Next Steps"),
    ("34", "Three things you must know"),
    ("35", "What is left to do"),
    ("APPENDIX", "Reference"),
    ("A", "Environment variables"),
    ("B", "Command reference"),
    ("C", "Troubleshooting"),
]

for num, title in toc:
    if num.startswith("PART") or num == "APPENDIX":
        story.append(Paragraph(f"{num} &nbsp; {title}", S["tocp"]))
    else:
        story.append(Paragraph(
            f"<font color='#5A6270'>{num}.</font> &nbsp; {title}", S["toc"]))

story.append(PageBreak())

# =====================================================================
part_banner(1, "The Project",
            "What CricGeek is, the problem EQS solves, and how the pieces fit together.")

h1("1. What CricGeek is")
para(
    "CricGeek is a cricket content platform. Alongside the things you would expect of a "
    "cricket site &mdash; live scores, a fixtures calendar, match previews and post-match "
    "analysis &mdash; its centre of gravity is a <b>community of cricket writers</b>. "
    "Registered writers publish opinion pieces, match reports, tactical breakdowns, and "
    "personal cricket stories, which the platform calls <i>expressions</i>."
)
para(
    "Readers follow writers, save pieces, and react with a cricket-ball reaction. Writers "
    "accumulate a profile: an archetype, a level, badges, achievements, and contest "
    "standings. The platform also runs a live commentary feature where a creator speaks "
    "into a microphone and their commentary is published in near real time."
)
para(
    "That community model creates a hard problem, and it is the problem this document is "
    "about. If writer status, contest results, and feed prominence are driven by content "
    "quality, then <b>something has to decide what &ldquo;quality&rdquo; means</b> &mdash; "
    "consistently, explainably, and at a volume no editorial team could read by hand."
)

h2("The two workstreams covered here")
table(
    ["Workstream", "What it does", "Where it lives"],
    [
        ["<b>EQS</b><br/>Expression Quality Score",
         "Evaluates the quality, credibility, expression, reasoning, originality, and "
         "suitability of a piece of cricket writing. Produces a score, a confidence, a "
         "dimension breakdown, evidence, and flags.",
         "src/lib/eqs/"],
        ["<b>Voice-to-Commentary</b>",
         "Converts a creator's spoken cricket commentary into publish-ready live "
         "commentary while preserving meaning and style, inside a latency budget.",
         "src/lib/voice/"],
        ["<b>Database design</b>",
         "Persists scores, component evidence, verified claims, plagiarism findings, "
         "model versions, Writer DNA history, and a full audit trail.",
         "prisma/ + src/lib/eqs/db-ddl.ts"],
    ],
    widths=[22, 56, 22], mono_cols=(2,),
)

h1("2. Why EQS exists")
para(
    "The naive approaches to scoring writing all fail in ways that matter on a cricket "
    "platform, and each failure would actively harm the community it is meant to serve:"
)
table(
    ["Naive approach", "Why it fails on CricGeek"],
    [
        ["Sentiment analysis",
         "A blistering, well-argued critique of a selection policy is <i>excellent</i> "
         "cricket writing. Sentiment scoring would bury it and reward bland praise. Fans "
         "would learn that criticism is punished."],
        ["Grammar checking",
         "Rewards clean prose that says nothing. A grammatically perfect 300 words of "
         "filler would outscore a rough-edged piece with a genuine tactical insight."],
        ["An AI detector",
         "Detectors produce false positives on any careful, structured writer. Rejecting "
         "on that signal would expel exactly the writers the platform wants."],
        ["Asking one language model &ldquo;is this good?&rdquo;",
         "The model will confidently hallucinate cricket statistics, cannot know whether "
         "text was copied from the corpus, and gives unstable answers run to run. "
         "Nothing about the verdict is auditable or reproducible."],
    ],
    widths=[24, 76],
)
para(
    "EQS is the answer to all four. It is a <b>pipeline of specialist systems</b> whose "
    "structured results are combined by a deterministic scoring engine. Cricket "
    "statistics are verified against real cricket data, not guessed by a model. "
    "Plagiarism is checked by dedicated systems. Language judgement is the model's job "
    "and nothing else is. And every score carries the evidence and version information "
    "needed to explain it months later."
)

h1("3. System architecture")
table(
    ["Layer", "Technology", "Notes"],
    [
        ["Web application", "Next.js 16 (App Router), React 19, TypeScript, Tailwind 4",
         "Frontend and API routes in one deployment"],
        ["Backend API", "Next.js route handlers under src/app/api/",
         "Node runtime; all EQS work is server-side"],
        ["Database", "Microsoft SQL Server via Prisma 5",
         "Schema in prisma/schema.prisma"],
        ["Authentication", "NextAuth v5 (credentials + Google)",
         "Roles: user, writer, admin"],
        ["Primary AI model", "Google Gemini (configurable)",
         "Structured JSON output for language analysis"],
        ["Fallback AI model", "Self-hosted Ollama (Qwen)",
         "Also drives BQS, tags, commentary polish"],
        ["Cricket data", "SportMonks API",
         "Fixtures, live scores, scorecards, squads"],
        ["Fact-check search", "Tavily or Serper",
         "For claims the scorecard cannot answer"],
        ["Speech-to-text", "Deepgram (Whisper service as fallback)",
         "Batch today, streaming supported server-side"],
        ["Python services", "FastAPI (insights, RAG)",
         "Optional; advanced match-insights pages only"],
    ],
    widths=[20, 42, 38],
)

callout(
    "Everything degrades, nothing hard-fails",
    "Every external dependency above is optional except the database and auth. When a "
    "provider is missing or down, the affected stage returns a component result marked "
    "<font face='Courier' size='8'>unavailable</font>, the pipeline continues, and the "
    "final score comes back with <b>lower confidence</b> &mdash; which is the honest "
    "signal that less of the pipeline ran. "
    "<font face='Courier' size='8'>/api/health</font> reports exactly what is switched on.",
    GREEN,
)

h1("4. How an expression flows through the system")
numbered([
    "A writer drafts a piece in the editor and presses publish.",
    "The editor calls <font face='Courier' size='8'>POST /api/ai/eqs</font> to score the "
    "draft and shows the breakdown while publishing. This run is not persisted &mdash; "
    "drafts are scored repeatedly and only saved posts are worth an audit row.",
    "<font face='Courier' size='8'>POST /api/blogs</font> creates the post, stores the "
    "linked match id (so statistics can later be checked against that match's "
    "scorecard), registers any contest entry, and writes a vector embedding of the text "
    "into the internal plagiarism corpus.",
    "<font face='Courier' size='8'>POST /api/scoring/analyze</font> runs the legacy BQS "
    "pipeline and then the EQS pipeline, persisting both. EQS runs second deliberately: "
    "both need the fact-check search, so running BQS first warms a content-hash cache "
    "and the search is paid for once.",
    "EQS results are written to <font face='Courier' size='8'>EqsRun</font> and its child "
    "tables, a summary is mirrored onto <font face='Courier' size='8'>BlogScore</font> so "
    "feed queries need no join, and the Writer DNA mix that drove the weighting is "
    "snapshotted for auditability.",
    "If the run tripped a guardrail or came back with low confidence, it appears in "
    "<font face='Courier' size='8'>/api/eqs/review-queue</font> for an editor. It is "
    "<b>not</b> auto-rejected &mdash; publishing is never blocked by EQS.",
    "Anyone can later read the stored breakdown from "
    "<font face='Courier' size='8'>GET /api/eqs/[blogId]</font>, with the original "
    "evidence, claim verdicts, and the model versions that produced it.",
])

story.append(PageBreak())

# =====================================================================
part_banner(2, "The EQS System",
            "The pipeline, the dimensions, the weighting, and the guardrails.")

h1("5. What EQS is, and what it is not")
para(
    "EQS evaluates the quality, credibility, expression, reasoning, originality, and "
    "suitability of cricket content. The final score is produced <b>only after</b> the "
    "specialist component results are available."
)
table(
    ["EQS is not", "Because"],
    [
        ["an AI detector",
         "AI-assistance probability is one signal among thirteen dimensions, carries zero "
         "weight in the sum, and is capped at an 8-point deduction."],
        ["a sentiment score",
         "The sentiment dimension scores whether the emotional direction <i>fits the "
         "argument in context</i>. Raw polarity is recorded as evidence only and never "
         "moves the score by itself."],
        ["a grammar checker",
         "Expression quality is one dimension of thirteen, and is weighted differently "
         "for an analyst than for a storyteller."],
    ],
    widths=[22, 78],
)

h1("6. Core principles, and where each is enforced")
para(
    "These are not aspirations in a document &mdash; each one is enforced by a specific "
    "structural decision in the code, which is what makes it hold under pressure."
)
table(
    ["Principle", "Structural enforcement"],
    [
        ["No single signal decides whether an article is good or bad",
         "Every guardrail is a <b>cap</b>, never a fixed score. An article that trips one "
         "still keeps the ordering its other dimensions earned below that cap."],
        ["Negative sentiment is not automatically poor quality",
         "The <font face='Courier' size='8'>sentiment</font> dimension is defined as "
         "appropriateness in context, not polarity. The model prompt states this as a "
         "hard rule, and the benchmark measures it explicitly."],
        ["Positive wording is not automatically high quality",
         "<font face='Courier' size='8'>sarcasm_intent</font> and "
         "<font face='Courier' size='8'>evidence_quality</font> are scored independently "
         "of tone, so vague praise cannot score well."],
        ["AI-generated probability is a signal, not a rejection rule",
         "<font face='Courier' size='8'>ai_assistance</font> has weight <b>0</b> in every "
         "DNA weight table. It is structurally incapable of being a rejection rule, and "
         "its guardrail is a bounded deduction of at most 8 points."],
        ["Cricket statistics must be verified separately",
         "The <font face='Courier' size='8'>statistical_claims</font> dimension is "
         "excluded from the language model's remit entirely and owned by the verification "
         "module. The prompt explicitly forbids the model from judging stat correctness."],
        ["Internal and external plagiarism are separate systems",
         "Two modules, two component results, two database rows, two independent "
         "guardrails."],
        ["The final model must not invent stat or plagiarism findings",
         "The interpretation stage receives only <i>normalised component results</i>, and "
         "its adjustment is clamped to a configurable maximum (default 6 points)."],
    ],
    widths=[27, 73],
)

h1("7. The eleven-stage pipeline")
table(
    ["#", "Stage", "Implementation"],
    [
        ["1", "Article input and metadata", "API route"],
        ["2", "Writer DNA", "dna.ts + dna-weights.ts"],
        ["3", "Fast checks (deterministic)", "stages/fast-checks.ts"],
        ["4", "Language analysis", "stages/language-analysis.ts"],
        ["5", "Claim extraction", "stages/claim-extraction.ts"],
        ["6", "Cricket verification", "stages/cricket-verification.ts"],
        ["7", "Internal plagiarism", "stages/internal-plagiarism.ts"],
        ["8", "External plagiarism", "stages/external-plagiarism.ts"],
        ["9", "Component normalisation", "scoring-engine.ts"],
        ["10", "Final EQS (weight, interpret, guardrail)",
         "scoring-engine.ts + stages/final-interpretation.ts"],
        ["11", "Output and persistence", "service.ts + persistence.ts"],
    ],
    widths=[6, 44, 50], mono_cols=(2,), bold_cols=(0,), nowrap_cols=(0,),
)

h2("Concurrency and ordering")
para(
    "Ordering is load-bearing. Stages 4, 5, 7, and 8 run <b>concurrently</b>. Stage 6 "
    "waits on stage 5, because it verifies the claims stage 5 extracted. Stage 10 waits "
    "on everything, because it can only weigh evidence that exists."
)
code([
    "                      +-- 4  Language analysis   --+",
    "  3 Fast checks  -->  |   5  Claim extraction  --> 6 Cricket verification --+",
    "  2 Writer DNA        |   7  Internal plagiarism --+                        |",
    "                      +-- 8  External plagiarism --+                        |",
    "                                                                            v",
    "        9 Normalise --> 10a DNA weighting --> 10b Model (+/- 6) --> 10c Guardrails",
    "                                                                            |",
    "                                                                            v",
    "                            11 Final EQS + confidence + explanation + flags",
])

h2("Failure behaviour")
para(
    "Each stage is wrapped in its own timeout, and the whole pipeline has an outer "
    "ceiling on top of that (the per-stage budgets can sum to more than a serverless "
    "invocation allows). A stage that fails or times out returns a degraded component "
    "result with a flag, and the pipeline continues."
)
para(
    "If no language provider answers at all, the deterministic fast-check heuristics "
    "supply every dimension. <b>That path is the floor, not the target.</b> It cannot "
    "read sarcasm in context, and it cannot detect fabricated statistics or copied text, "
    "because those come from the specialist systems. Confidence drops accordingly, which "
    "is the point."
)

h1("8. The thirteen evaluation dimensions")
para("All dimensions are <b>0&ndash;100 and higher is always better</b>. That uniformity "
     "matters: it means a toxicity score of 100 signals no personal attacks, and no part "
     "of the engine needs to remember which scales are inverted.")
table(
    ["Key", "Dimension", "Owned by"],
    [
        ["originality", "Own information, interpretation, framing, expression",
         "language analysis, scaled by both plagiarism systems"],
        ["expression_quality", "Clarity, readability, precision, sentence quality",
         "language analysis"],
        ["coherence", "Logical flow, paragraph relationships", "language analysis"],
        ["relevance_focus", "Topic connection; avoids filler and repetition",
         "language analysis"],
        ["sentiment", "Whether emotional direction fits the argument in context",
         "language analysis"],
        ["sarcasm_intent", "Sarcasm, mockery, literal vs intended meaning",
         "language analysis"],
        ["toxicity", "Insults, harassment, targeted attacks (100 = none)",
         "language analysis + fast checks"],
        ["constructive_criticism", "Explains a weakness vs attacking a person",
         "language analysis"],
        ["reasoning", "Argument quality, cause and effect, inference",
         "language analysis"],
        ["evidence_quality", "Whether claims are <i>supported</i> (not whether true)",
         "language analysis"],
        ["statistical_claims", "Whether claims are <i>correct</i>",
         "<b>cricket verification only</b>"],
        ["writer_dna_suitability", "Success against the writer's intended type",
         "language analysis"],
        ["ai_assistance", "AI-generation indicators (100 = reads as human)",
         "fast checks + language analysis"],
    ],
    widths=[22, 45, 33], mono_cols=(0,),
    caption="Two deliberate exclusions: statistical_claims is outside the model's remit, "
            "and ai_assistance is outside the weighted sum.",
)

h1("9. Writer DNA and mixed profiles")
para(
    "EQS is DNA-aware because different cricket writers are trying to do different "
    "things. A storyteller's piece with no statistics in it is not a failed analyst "
    "piece, and should not be scored as one."
)
table(
    ["DNA", "Typical purpose", "Higher-priority dimensions"],
    [
        ["Fan", "Passion, perspective, emotional connection",
         "Originality, expression, coherence, relevance, constructive tone"],
        ["Analyst", "Data, tactics, technical interpretation",
         "Stat accuracy, evidence, reasoning, relevance, clarity"],
        ["Debater", "Arguments, comparisons, viewpoints",
         "Reasoning, evidence, constructive disagreement, coherence"],
        ["Storyteller", "Narrative, context, human angle",
         "Originality, narrative flow, coherence, expression, engagement"],
    ],
    widths=[13, 32, 55], bold_cols=(0,),
)

h2("Resolution order")
numbered([
    "An explicit <font face='Courier' size='8'>dnaOverride</font> (used by the benchmark "
    "runner to score the same text against different profiles).",
    "The writer's stored <font face='Courier' size='8'>WriterDNA</font> row. A brand-new "
    "writer sitting at the 25/25/25/25 default carries no information, so that case falls "
    "through.",
    "Inference from the article text itself, for anonymous or first-time writers.",
])

callout(
    "Mixed profiles are genuinely supported, not rounded away",
    "The result is always a <b>normalised mix across all four profiles</b>, never a single "
    "archetype. <font face='Courier' size='8'>buildDnaWeights()</font> blends the four "
    "weight tables by that mix, so a writer who is 60% analyst and 40% storyteller gets "
    "genuinely blended weights. A profile needs 45% of the mix to be called dominant; "
    "below that the run is marked <font face='Courier' size='8'>mixed: true</font>. "
    "Blended weights are re-normalised to sum to exactly 1.",
    GREEN,
)

para(
    "Weights live in <font face='Courier' size='8'>src/data/eqs-scoring-config.json</font>, "
    "<b>not in code</b>, and that file is versioned. Every stored run records which config "
    "version produced it, so a score from three months ago stays explainable even after "
    "the weights move."
)

h1("10. Final scoring methodology")
code([
    "Article",
    "  -> Writer DNA",
    "  -> specialist analysis            (stages 3-8, concurrent)",
    "  -> individual component results",
    "  -> normalisation                  (stage 9)",
    "  -> DNA/context weighting          -> baseScore",
    "  -> final model interpretation     -> bounded +/- EQS_MAX_MODEL_ADJUSTMENT (default 6)",
    "  -> deterministic guardrails       -> capped",
    "  -> Final EQS + confidence + explanation + flags",
])
callout(
    "Why the model runs before the guardrails",
    "Two reasons, both non-negotiable. First, the model can never talk a score past a hard "
    "constraint &mdash; the guardrails get the last word. Second, its influence is clamped "
    "to a few points, so two runs of the same article cannot diverge meaningfully. That is "
    "the reproducibility guarantee, and it is why the adjustment is a bounded nudge rather "
    "than a free verdict.",
    NAVY,
)

h1("11. Deterministic guardrails")
para("Each guardrail is a <i>ceiling</i>. An article that trips one still ranks against "
     "other capped articles on the merits of its remaining dimensions.")
table(
    ["Guardrail code", "Trigger", "Cap"],
    [
        ["TOXICITY_CAP", "toxicity &lt; 35, or explicit abuse detected", "45"],
        ["SPAM_CAP", "spam / promotion patterns dominate", "30"],
        ["INTERNAL_EXACT_MATCH_CAP",
         "at least 35% of the draft appears verbatim in CricGeek content", "40"],
        ["INTERNAL_DUPLICATE_CAP", "vector similarity at or above 0.85", "45"],
        ["EXTERNAL_PLAGIARISM_CAP",
         "provider matched 25% or more to outside sources", "45"],
        ["STAT_CONTRADICTION_CAP",
         "at least 1 claim contradicted by trusted data", "60"],
        ["STAT_CONTRADICTION_CAP_SEVERE", "3 or more claims contradicted", "45"],
        ["THIN_CONTENT_CAP", "under 60 words", "55"],
        ["AI_ASSISTANCE_SIGNAL_PENALTY", "ai_assistance &lt; 45",
         "bounded deduction, max 8 points"],
    ],
    widths=[32, 52, 16], mono_cols=(0,),
)
callout(
    "Guardrails are recorded even when they change nothing",
    "If a score is <i>already</i> below a guardrail's cap, the guardrail is still recorded "
    "with a note saying no reduction was needed. Staying silent there would let an abusive "
    "or plagiarised article report &ldquo;no deterministic guardrail needed&rdquo; in its "
    "audit trail. This was a real bug caught by the self-test &mdash; see section 20.",
    AMBER,
)

h1("12. Confidence and human review")
para(
    "Confidence is the weight-weighted mean of per-dimension confidence, reduced for each "
    "unavailable or errored component, and reduced again when a critical flag conflicts "
    "with an otherwise high score. It is the honest measure of how much of the pipeline "
    "actually ran."
)
para("A run is routed to <font face='Courier' size='8'>/api/eqs/review-queue</font> when:")
bullets([
    "confidence falls below 0.5, or",
    "a guardrail demands it (toxicity, plagiarism, contradicted statistics), or",
    "sarcasm and intent are genuinely ambiguous, or",
    "the interpretation model itself asks for a human.",
])
callout(
    "Flagging is not rejection",
    "A toxicity, plagiarism, or AI-assistance signal <b>flags</b> a post for a human. It "
    "does not auto-reject it, and EQS never blocks publishing. This follows directly from "
    "the principle that no single signal decides whether an article is good or bad.",
    GREEN,
)

h1("13. The three specialist systems")

h2("Cricket statistics verification")
para("Claims are routed to trusted sources in order of authority:")
numbered([
    "The <b>match scorecard</b> from the cricket data API. Strongest evidence, but it "
    "requires the post to be linked to a match.",
    "The <b>historical warehouse</b> and <b>web-search fact-check</b> pipeline for "
    "anything the scorecard cannot answer.",
])
para(
    "Verdicts are three-way: <font face='Courier' size='8'>supported</font>, "
    "<font face='Courier' size='8'>contradicted</font>, or "
    "<font face='Courier' size='8'>inconclusive</font>. <b>Only a contradiction pulls the "
    "score down.</b> &ldquo;The scorecard has nothing on this player&rdquo; is not evidence "
    "against the writer, and conflating the two would punish writers for gaps in our data. "
    "When nothing can be resolved at all, the dimension stays neutral at 75 and confidence "
    "drops &mdash; a writer should not lose points for our infrastructure being down."
)
para(
    "Scorecard matching is shared with the legacy BQS pipeline via "
    "<font face='Courier' size='8'>lib/cricket-stat-match.ts</font>, so both scorers agree "
    "on what &ldquo;verified&rdquo; means."
)

h2("Internal plagiarism")
para("Both mechanisms the specification requires, used in sequence:")
bullets([
    "<b>Vector similarity</b> &mdash; hashed embeddings over the "
    "<font face='Courier' size='8'>ExpressionEmbedding</font> table find the nearest "
    "neighbours cheaply.",
    "<b>Exact matching</b> &mdash; an 8-word shingle overlap against those neighbours' "
    "real text, which produces the actual matched passage as stored evidence. Eight words "
    "is long enough that natural overlap is rare.",
])
para("The overlap ratio is asymmetric on purpose: it measures how much of <i>this</i> "
     "article is reused, not how similar two documents are overall.")

h2("External plagiarism")
para(
    "A genuinely separate system calling a dedicated third-party provider, storing the "
    "provider's own evidence rather than re-deriving a verdict locally. Unconfigured, it "
    "reports <font face='Courier' size='8'>unavailable</font> and the pipeline continues. "
    "Point <font face='Courier' size='8'>EXTERNAL_PLAGIARISM_API_URL</font> at your "
    "provider's scan endpoint, or at a thin adapter of your own; the response reader "
    "accepts the field names used by the common vendors."
)

h1("14. Structured intermediate results")
para("Every module returns the same shape, so the scoring engine only ever consumes "
     "structured data &mdash; never prose.")
table(
    ["Field", "Purpose"],
    [
        ["component", "Module name"],
        ["score", "Normalised 0-100, or null where the module produces no score"],
        ["confidence", "0-1 confidence in this module's own result"],
        ["evidence", "Module-specific supporting evidence"],
        ["flags", "Issues requiring attention, each with a severity"],
        ["claims", "Extracted claims and their verification state"],
        ["source", "Provider or module that produced the result"],
        ["version", "Model, rule, or API version"],
        ["status", "ok / unavailable / error / skipped"],
        ["durationMs", "Stage latency"],
    ],
    widths=[22, 78], mono_cols=(0,),
)

h1("15. Model configuration")
para(
    "The primary language-analysis model is Gemini, kept configurable so newer or cheaper "
    "models can be benchmarked later without touching business logic."
)
code([
    "EQS_PROVIDER=auto              # auto | gemini | ollama | heuristic",
    "GEMINI_API_KEY=...",
    "GEMINI_EQS_MODEL=gemini-3.5-flash",
    "GEMINI_EQS_FAST_MODEL=         # cheaper model for high-volume sub-tasks",
])
para(
    "<font face='Courier' size='8'>auto</font> walks Gemini, then Ollama, then heuristics, "
    "and uses the first that is configured. <b>Pin "
    "<font face='Courier' size='8'>EQS_PROVIDER</font> to a single value before comparing "
    "benchmark reports</b>, otherwise two reports may not have used the same model."
)
callout(
    "Verify the Gemini model id before deploying",
    "<font face='Courier' size='8'>GEMINI_EQS_MODEL</font> defaults to "
    "<font face='Courier' size='8'>gemini-3.5-flash</font> because that is the id named in "
    "the technical specification. Google's published Flash line has used 1.5, 2.0, and 2.5 "
    "ids. <b>If the id does not exist in your project, every Gemini call fails and the "
    "pipeline silently falls back</b> to Ollama or to heuristics. After configuring, check "
    "<font face='Courier' size='8'>/api/health</font> and confirm "
    "<font face='Courier' size='8'>checks.eqsPrimaryProvider</font> reads "
    "<font face='Courier' size='8'>gemini</font>.",
    RED,
)

story.append(PageBreak())

# =====================================================================
part_banner(3, "Voice-to-Commentary",
            "Spoken commentary to published text, inside a measured latency budget.")

h1("16. Pipeline and latency budget")
table(
    ["#", "Stage", "Function", "Implementation"],
    [
        ["1", "Microphone", "Capture creator speech", "Browser MediaRecorder"],
        ["2", "Streaming STT", "Speech to text, low latency",
         "voice/streaming.ts, deepgram.ts"],
        ["3", "Cleanup", "Fix transcription damage without changing meaning",
         "commentary-player-correction.ts"],
        ["4", "Transformation", "Low-latency model turns transcript into commentary",
         "commentary-polish.ts"],
        ["5", "Output", "Send to the commentary API",
         "/api/commentary/[sessionId]/entries"],
        ["6", "Target", "About 15-30s end to end or faster",
         "measured per stage, stored per run"],
    ],
    widths=[6, 17, 40, 37], mono_cols=(3,), bold_cols=(0,), nowrap_cols=(0,),
)
para(
    "Every run records <font face='Courier' size='8'>sttMs</font>, "
    "<font face='Courier' size='8'>cleanupMs</font>, "
    "<font face='Courier' size='8'>transformMs</font>, and "
    "<font face='Courier' size='8'>totalMs</font> separately, so a latency regression can "
    "be <b>attributed to a stage rather than guessed at</b>. The response includes:"
)
code([
    '{',
    '  "stages":  { "sttMs": 1840, "cleanupMs": 2, "transformMs": 1120, "totalMs": 3390 },',
    '  "latencyMs": 3390,',
    '  "targetMs": 30000,',
    '  "withinTarget": true,',
    '  "latencyWarning": false',
    '}',
])
para(
    "Observed latency across stored runs is available from "
    "<font face='Courier' size='8'>getVoiceLatencyStats()</font>, which reports the mean "
    "for each stage plus p95 and max on the total, and the share of runs inside target. "
    "That makes the specification's target <i>measurable</i> rather than merely asserted."
)

h2("Player-name accuracy")
para("Wrong player names are the most damaging failure mode in live commentary, so "
     "correction happens in three places:")
numbered([
    "The session's squad list is passed to the speech-to-text provider as keyterms, so "
    "names are biased toward correct spellings <i>at transcription time</i>.",
    "Deterministic roster-based correction runs on the raw transcript.",
    "The same deterministic correction runs <b>again after</b> the model polish &mdash; "
    "because the model is the last thing to touch the text, and a name it reintroduced "
    "incorrectly would otherwise ship.",
])

h1("17. Streaming speech-to-text")
para(
    "Batch transcription pays an upload round-trip for every clip, and that dominates the "
    "latency budget. <font face='Courier' size='8'>POST /api/commentary/stt-token</font> "
    "mints a short-lived, scoped provider credential so the browser can stream microphone "
    "audio directly to the provider &mdash; the long-lived API key never leaves the server."
)
callout(
    "Status: server side complete, client not yet migrated",
    "The commentary UI still uses the batch route, which continues to work unchanged, so "
    "this addition is purely additive. Adopting streaming is a frontend change: open the "
    "socket with the minted token, send audio frames, and post the final transcript. "
    "Disable the endpoint entirely with "
    "<font face='Courier' size='8'>VOICE_STREAMING_ENABLED=false</font>.",
    AMBER,
)

story.append(PageBreak())

# =====================================================================
part_banner(4, "Database Design",
            "What is stored, so that a score can be explained months later.")

h1("18. Tables, indexes, and retention")
table(
    ["Area", "Table", "Holds"],
    [
        ["EQS", "EqsRun",
         "Final score, base score, confidence, band, flags, guardrails, explanation, DNA "
         "snapshot, timings, pipeline and config version"],
        ["EQS", "EqsComponentResult",
         "Per-module score, confidence, evidence, flags, source, version, latency"],
        ["Verification", "EqsClaim",
         "Claim text and type, player, metric, value, status, verification source, "
         "provider, evidence, timestamp"],
        ["Plagiarism", "EqsPlagiarismResult",
         "Internal and external findings as separate rows: similarity, matched percent, "
         "matched post, matched passage, provider evidence"],
        ["Models", "EqsModelVersion",
         "Provider, model, prompt version, latency, status per analysis stage"],
        ["Audit", "EqsAuditEvent",
         "Processing events, failures, timeouts, retries, with stage and duration"],
        ["Writer DNA", "WriterDNAHistory",
         "DNA classification snapshots, so a past score stays explainable after the live "
         "profile moves on"],
        ["Voice", "VoiceCommentaryJob",
         "Transcript, cleaned transcript, commentary, providers and models, status, "
         "per-stage latency, target compliance"],
        ["Plagiarism", "ExpressionEmbedding",
         "Vector index of published expressions, for internal duplicate detection"],
    ],
    widths=[14, 24, 62], mono_cols=(1,),
)
para(
    "<font face='Courier' size='8'>BlogScore</font> also carries a denormalised EQS "
    "summary (<font face='Courier' size='8'>eqs</font>, "
    "<font face='Courier' size='8'>eqsConfidence</font>, "
    "<font face='Courier' size='8'>eqsBand</font>, "
    "<font face='Courier' size='8'>eqsRunId</font>, "
    "<font face='Courier' size='8'>eqsRequiresReview</font>, "
    "<font face='Courier' size='8'>eqsVersion</font>, "
    "<font face='Courier' size='8'>eqsFlagsJson</font>) so feed and profile queries do not "
    "need to join <font face='Courier' size='8'>EqsRun</font>."
)

h2("One source of truth for the DDL")
para(
    "The DDL lives in <font face='Courier' size='8'>src/lib/eqs/db-ddl.ts</font>. "
    "<font face='Courier' size='8'>prisma/eqs_migration.sql</font> is <b>generated</b> from "
    "it by <font face='Courier' size='8'>npm run eqs:migration</font>, so the checked-in "
    "migration and the runtime bootstrap cannot drift apart. The same tables are also "
    "declared in <font face='Courier' size='8'>prisma/schema.prisma</font> so the ORM can "
    "read them."
)
para(
    "Tables self-bootstrap on first use via an idempotent "
    "<font face='Courier' size='8'>ensureEqsTables()</font>, which means a freshly cloned "
    "checkout starts scoring without a separate migration step. Set "
    "<font face='Courier' size='8'>EQS_AUTO_MIGRATE=false</font> once you have applied the "
    "SQL yourself."
)

h2("Indexes")
para(
    "Chosen around the actual query patterns: latest run for a post "
    "(<font face='Courier' size='8'>blogId, createdAt DESC</font>), runs per writer, cache "
    "lookups by <font face='Courier' size='8'>contentHash</font>, the human-review queue "
    "(<font face='Courier' size='8'>requiresHumanReview, createdAt DESC</font>), component "
    "health (<font face='Courier' size='8'>component, status</font>), claim triage, and "
    "voice latency reporting."
)

h2("Retention")
callout(
    "Why the audit table has no foreign key",
    "<font face='Courier' size='8'>EqsRun</font> children cascade on delete. "
    "<font face='Courier' size='8'>EqsAuditEvent</font> deliberately has <b>no</b> foreign "
    "key to <font face='Courier' size='8'>EqsRun</font> &mdash; an event must be recordable "
    "even when the run row was never written, and that is precisely the case where you need "
    "the audit trail. Audit events and voice jobs are therefore not cascaded and need their "
    "own retention policy if volume becomes a concern.",
    NAVY,
)

story.append(PageBreak())

# =====================================================================
part_banner(5, "What Was Built",
            "The defects found and fixed, and the complete file inventory.")

h1("19. Build-breaking bugs that were fixed")
callout(
    "The repository did not compile before this work",
    "<font face='Courier' size='8'>npx tsc --noEmit</font> was failing on "
    "<font face='Courier' size='8'>src/lib/scoring.ts</font>, the existing BQS scorer. "
    "A bad find-and-replace had corrupted two pieces of it. "
    "<font face='Courier' size='8'>npm run build</font> could not have succeeded on a "
    "clean clone.",
    RED,
)
table(
    ["Location", "Defect", "Impact"],
    [
        ["scoring.ts:404",
         "<font face='Courier' size='8'>detectSarcasticRidicule()</font> returned "
         "<font face='Courier' size='8'>lowEvidenceAttack</font>, a variable that was "
         "never declared.",
         "A <font face='Courier' size='8'>ReferenceError</font> on every sarcasm check, "
         "and <font face='Courier' size='8'>TS18004</font> at build time. Fixed by "
         "implementing it from how the two call sites use it."],
        ["scoring.ts:281",
         "The <font face='Courier' size='8'>concerns?: string[]</font> field of the model "
         "response type had been overwritten with an unrelated string literal.",
         "Type errors in three places, and the model's &ldquo;concerns&rdquo; output was "
         "silently unreadable."],
        ["scoring.ts:5", "A header comment line clobbered by the same replace.",
         "Cosmetic, fixed alongside."],
    ],
    widths=[16, 40, 44], mono_cols=(0,),
    caption="Typecheck baseline moved from 88 errors to 81. The remaining 81 are all one "
            "unrelated class - see section 34.",
)

h1("20. Bugs found by the self-test")
para(
    "An offline self-test was written as part of this work "
    "(<font face='Courier' size='8'>npm run eqs:selftest</font>). It caught two real bugs "
    "in the new code, which is exactly why it exists:"
)
table(
    ["Bug", "Root cause", "Fix"],
    [
        ["Blended mixed-profile weights summed to <b>1.0030</b>, not 1.",
         "Rounding 13 weights independently defeated the re-normalisation step that was "
         "supposed to guarantee the invariant.",
         "The residual is now placed on the heaviest weight, making &ldquo;weights sum to "
         "1&rdquo; exact."],
        ["A guardrail whose score was <i>already</i> below its cap was not recorded at all.",
         "The cap helper returned early when no reduction was needed, so an abusive post's "
         "audit trail read &ldquo;no deterministic guardrail needed&rdquo;.",
         "Every guardrail that fires is now recorded, with a note when no reduction was "
         "required."],
    ],
    widths=[28, 38, 34],
)

h1("21. Backend defects found and fixed")
table(
    ["Area", "Defect and impact"],
    [
        ["<b>/api/blogs POST dropped matchId and contestId</b>",
         "The frontend sends both; the route ignored them. "
         "<font face='Courier' size='8'>matchTag</font> was never set, which means "
         "<b>cricket statistics verification never had a scorecard to check against for any "
         "user-published post</b> &mdash; it always fell back to heuristics. This was the "
         "single biggest thing blocking the verification workstream from working at all. "
         "Contest submissions were also never created, so those leaderboards were dead."],
        ["<b>withTimeout did not enforce its own deadline</b>",
         "It aborted the signal but did not <i>race</i> the deadline, so a stage whose "
         "underlying library ignored the signal could hold the pipeline open indefinitely. "
         "Now races the deadline and reports a typed timeout."],
        ["<b>EQS_PIPELINE_TIMEOUT_MS was configured but never applied</b>",
         "Now wired as an outer ceiling, because the per-stage budgets can sum to more than "
         "a serverless invocation allows."],
        ["<b>Duplicate fact-check spend</b>",
         "BQS and EQS each called the paid fact-check search. Both now share a "
         "content-hash-keyed cache, so <font face='Courier' size='8'>/api/scoring/analyze"
         "</font> pays for the search once instead of twice."],
        ["<b>.env.example did not exist</b>",
         "The documentation referenced it, and <font face='Courier' size='8'>.gitignore"
         "</font>'s <font face='Courier' size='8'>.env*</font> rule would have excluded it "
         "anyway. Created fully commented, with an exception added so it actually ships."],
        ["<b>Health endpoint was silent about EQS</b>",
         "Now reports <font face='Courier' size='8'>eqsReady</font>, "
         "<font face='Courier' size='8'>eqsPrimaryProvider</font>, "
         "<font face='Courier' size='8'>eqsSchemaReady</font>, "
         "<font face='Courier' size='8'>eqsStatVerificationReady</font>, "
         "<font face='Courier' size='8'>voiceReady</font>, and versions."],
        ["<b>Code duplication</b>",
         "About 90 lines of JSON parsing and 100 lines of scorecard matching were "
         "duplicated; both extracted to shared modules so BQS and EQS cannot diverge."],
    ],
    widths=[26, 74],
)

h1("22. Complete file inventory")
h2("New files")
table(
    ["Group", "Files"],
    [
        ["EQS core (src/lib/eqs/)",
         "types.ts, config.ts, utils.ts, json.ts, cache.ts, cached-fact-check.ts, "
         "dna.ts, dna-weights.ts, scoring-engine.ts, pipeline.ts, service.ts, "
         "benchmark.ts, audit.ts, persistence.ts, db-ddl.ts, db-schema.ts"],
        ["EQS providers",
         "providers/types.ts, providers/gemini.ts, providers/ollama.ts, providers/index.ts"],
        ["EQS stages",
         "stages/fast-checks.ts, stages/language-analysis.ts, stages/claim-extraction.ts, "
         "stages/cricket-verification.ts, stages/internal-plagiarism.ts, "
         "stages/external-plagiarism.ts, stages/final-interpretation.ts"],
        ["Voice (src/lib/voice/)", "config.ts, pipeline.ts, persistence.ts, streaming.ts"],
        ["Shared", "src/lib/cricket-stat-match.ts"],
        ["Data", "src/data/eqs-scoring-config.json, src/data/eqs-benchmark.json"],
        ["API routes",
         "api/eqs/run, api/eqs/[blogId], api/eqs/benchmark, api/eqs/config, "
         "api/eqs/review-queue, api/commentary/stt-token"],
        ["Database", "prisma/eqs_migration.sql (generated)"],
        ["Scripts",
         "scripts/eqs-selftest.mts, scripts/generate-eqs-migration.mjs, "
         "scripts/setup.ps1, scripts/setup.sh"],
        ["Docs and config", "SETUP.md, .env.example, docs/generate_eqs_handover_pdf.py"],
    ],
    widths=[20, 80], mono_cols=(1,), bold_cols=(0,), font_scale=0.96,
)

h2("Modified files")
table(
    ["File", "Change"],
    [
        ["src/lib/scoring.ts", "Bug fixes; deduped onto shared modules; cached fact-check"],
        ["src/lib/internal-originality.ts", "Exposes candidate matches for exact-match pass"],
        ["src/app/api/ai/eqs/route.ts", "Rewritten onto the pipeline; legacy contract kept"],
        ["src/app/api/commentary/transcribe/route.ts",
         "Refactored onto the staged voice pipeline; latency reporting added"],
        ["src/app/api/blogs/route.ts", "Persists matchId and contestId"],
        ["src/app/api/scoring/analyze/route.ts", "Runs and persists the EQS pipeline"],
        ["src/app/api/health/route.ts", "EQS and voice readiness checks"],
        ["prisma/schema.prisma", "Nine new models; EQS summary columns on BlogScore"],
        ["package.json", "setup, db:push, db:studio, eqs:selftest, eqs:migration, typecheck"],
        [".gitignore", "Un-ignores .env.example"],
        ["README.md", "Rewritten around quick start and EQS"],
        ["docs/05, 07, 10, 11, 13", "Database, API reference, EQS, voice, configuration"],
        ["src/lib/demo-data.ts", "Type-only widening"],
        ["src/app/writer/[id]/page.tsx", "Type-only widening"],
    ],
    widths=[34, 66], mono_cols=(0,), font_scale=0.96,
)
callout(
    "The only two frontend touches are type annotations",
    "<font face='Courier' size='8'>demo-data.ts</font> and "
    "<font face='Courier' size='8'>writer/[id]/page.tsx</font> received <b>type "
    "annotations only</b> &mdash; no UI or behaviour change. They were required: the page "
    "already read <font face='Courier' size='8'>score.processingStatus</font>, which the "
    "API returns but the local interface omitted, and that type error blocks "
    "<font face='Courier' size='8'>npm run build</font>. Flagged here because the brief "
    "was to leave the frontend alone.",
    AMBER,
)

story.append(PageBreak())

# =====================================================================
part_banner(6, "Testing Guide",
            "Eight levels, from a no-dependency smoke test to full calibration.")

h1("23. Test levels at a glance")
para("Work down the table. Each level needs strictly more setup than the one above it, so "
     "stop wherever your environment runs out.")
table(
    ["Level", "What it tests", "Needs", "Time"],
    [
        ["0", "The install works", "Node 20+", "1 min"],
        ["1", "Scoring maths and safety invariants",
         "Nothing (no keys, no database, no network)", "10 s"],
        ["2", "Types, lint, production build", "Prisma client generated", "2-4 min"],
        ["3", "What is actually configured", "App running", "1 min"],
        ["4", "Every endpoint responds correctly", "App running + database", "10 min"],
        ["5", "The principles hold on real text",
         "App + database + a language model", "20 min"],
        ["6", "Calibration accuracy and false-positive rates",
         "App + database + model + admin login", "5-30 min"],
        ["7", "Data is persisted and auditable", "Database access", "10 min"],
        ["8", "Voice pipeline and latency", "Deepgram key", "10 min"],
    ],
    widths=[8, 34, 42, 16], bold_cols=(0,), nowrap_cols=(0,),
)

h1("24. Level 0 - Verify the install")
code([
    "cd cricgeek-app",
    "node --version          # expect v20 or higher",
    "npm install",
])
para("Expected: dependencies install with no errors. If "
     "<font face='Courier' size='8'>npm</font> is not recognised, install Node.js LTS and "
     "reopen the terminal.")

h1("25. Level 1 - Offline self-test (no keys needed)")
para(
    "<b>Start here.</b> This is the fastest meaningful check and needs nothing configured. "
    "It runs the deterministic scoring core against all 36 benchmark samples with no "
    "database, no API keys, and no network, and asserts the invariants that must hold "
    "regardless of which provider is in use."
)
code(["npm run eqs:selftest"])
para("It enforces seven properties:")
numbered([
    "Every DNA weight table sums to exactly 1.",
    "Blended mixed-profile weights sum to exactly 1.",
    "<b>Reasoned criticism is never scored as toxic.</b> This is the specification's "
    "headline principle, checked on every sample labelled as constructive criticism.",
    "Explicit abuse always trips the toxicity guardrail.",
    "Spam patterns always trip the spam guardrail, and clean cricket writing never does.",
    "Scores stay within 0-100, and guardrails only ever <i>lower</i> a score.",
    "The AI-assistance signal never costs more than its configured cap.",
])
h3("Expected output (tail)")
code([
    "id            category            exp    eqs   band         tox  sarc  ai   guardrails",
    "eqs-hq-001    high-quality-human  high   67    publishable  96   88    92   -",
    "eqs-crit-001  strong-criticism    high   59.2  publishable  96   88    78   -",
    "eqs-tox-001   toxicity            low    45    needs-work   6    88    92   TOXICITY_CAP",
    "eqs-vague-001 vague-writing       low    30.9  below-bar    96   88    92   -",
    "...",
    "36 samples scored, 0 assertion failure(s).",
    "Self-test PASSED (deterministic fallback path).",
])
callout(
    "How to read that table honestly",
    "The <font face='Courier' size='8'>incorrect-stats</font> and "
    "<font face='Courier' size='8'>copied-text</font> rows score <i>well</i> here, and "
    "that is correct. This run has no verification or plagiarism specialist attached, and "
    "language heuristics genuinely cannot tell a fabricated statistic from a real one. "
    "That is the whole architectural point: those signals come from dedicated systems, "
    "not from reading the prose. To test them you need Level 5.",
    NAVY,
)

h1("26. Level 2 - Typecheck, lint, build")
code([
    "npx prisma generate     # required first - see the caveat below",
    "npm run typecheck",
    "npm run lint",
    "npm run build",
])
callout(
    "Expect typecheck noise if prisma generate cannot run",
    "If your network blocks <font face='Courier' size='8'>binaries.prisma.sh</font> (common "
    "on corporate networks, and the case during this implementation), "
    "<font face='Courier' size='8'>prisma generate</font> fails and you will see roughly 81 "
    "errors. They are all one class &mdash; "
    "<font face='Courier' size='8'>TS7006</font> implicit-any on Prisma callbacks and "
    "<font face='Courier' size='8'>TS2694</font> missing "
    "<font face='Courier' size='8'>Prisma</font> namespace types &mdash; and all of them "
    "resolve once the client generates. <b>None are in the EQS or voice code.</b> "
    "Confirm that with the filter below.",
    AMBER,
)
code([
    "# Should print nothing at all:",
    "npm run typecheck 2>&1 | grep -E 'lib/eqs|lib/voice|cricket-stat'",
])

h1("27. Level 3 - The health endpoint")
code([
    "npm run dev",
    "# then open, or curl:",
    "curl http://localhost:3000/api/health",
])
para("This is the fastest way to see what is actually wired up. The fields that matter:")
table(
    ["Field", "Should read", "If it does not"],
    [
        ["checks.database", "true", "DATABASE_URL is wrong, or SQL Server is not running"],
        ["checks.eqsSchemaReady", "true", "Run npm run db:push"],
        ["checks.eqsReady", "true", "Set GEMINI_API_KEY, or run Ollama locally"],
        ["checks.eqsPrimaryProvider", "gemini",
         "<b>heuristic means no AI model is configured</b> and scores will be flat"],
        ["checks.eqsStatVerificationReady", "true",
         "Set SPORTMONKS_API_TOKEN or TAVILY_API_KEY"],
        ["checks.eqsExternalPlagiarismConfigured", "true (optional)",
         "Set EXTERNAL_PLAGIARISM_API_URL; stage 8 stays unavailable without it"],
        ["checks.voiceReady", "true", "Set DEEPGRAM_API_KEY"],
    ],
    widths=[32, 20, 48], mono_cols=(0, 1),
)
para("<font face='Courier' size='8'>ok: false</font> at the top only means one of the three "
     "core checks is off. The endpoint still responds and tells you which.")

h1("28. Level 4 - API smoke tests")
h3("Score a draft (no sign-in required)")
code([
    'curl -X POST http://localhost:3000/api/ai/eqs \\',
    '  -H "Content-Type: application/json" \\',
    '  -d \'{"title":"Hard lengths","content":"Jasprit Bumrah barely bowled a yorker',
    'tonight, and that is exactly why the chase collapsed. He bowled the hard length into',
    'the surface and kept dragging the batters across the crease. Between overs eleven and',
    'sixteen the false-shot rate climbed because nobody could get under the ball."}\'',
])
para("Verify in the response:")
bullets([
    "<font face='Courier' size='8'>eqs</font>, "
    "<font face='Courier' size='8'>band</font>, and "
    "<font face='Courier' size='8'>confidence</font> are present and sane.",
    "<font face='Courier' size='8'>dimensions</font> has <b>13</b> entries and the weights "
    "sum to 1.",
    "<font face='Courier' size='8'>components</font> has <b>6</b> entries, each with a "
    "<font face='Courier' size='8'>status</font>.",
    "<font face='Courier' size='8'>overallEqs</font>, "
    "<font face='Courier' size='8'>weightedEqs</font>, and "
    "<font face='Courier' size='8'>attributes</font> are present &mdash; these are the "
    "<b>legacy fields the publish UI reads</b>, and they must never disappear.",
    "<font face='Courier' size='8'>modelVersions</font> names the provider and model that "
    "actually served the run.",
])
h3("The other endpoints")
table(
    ["Endpoint", "Method", "Access", "Check"],
    [
        ["/api/eqs/run", "POST", "author or admin",
         "Returns a score and <font face='Courier' size='8'>persistence.persisted: true</font>"],
        ["/api/eqs/[blogId]", "GET", "any",
         "Returns the stored run; add <font face='Courier' size='8'>?audit=1</font> as the "
         "author for the event trail"],
        ["/api/eqs/config", "GET", "admin",
         "Effective provider, model, weights, thresholds, versions"],
        ["/api/eqs/review-queue", "GET", "admin", "Runs flagged for a human"],
        ["/api/eqs/benchmark?coverage=1", "GET", "open",
         "Dataset coverage; costs nothing"],
        ["/api/scoring/analyze", "POST", "any",
         "Returns both <font face='Courier' size='8'>bqs</font> and an "
         "<font face='Courier' size='8'>eqs</font> block"],
    ],
    widths=[30, 9, 18, 43], mono_cols=(0,),
)
h3("Negative cases worth confirming")
table(
    ["Request", "Expected"],
    [
        ["Empty or very short <font face='Courier' size='8'>content</font>", "400"],
        ["Content over 60,000 characters", "413"],
        ["<font face='Courier' size='8'>/api/eqs/run</font> without sign-in", "401"],
        ["<font face='Courier' size='8'>/api/eqs/run</font> for someone else's post as a "
         "non-admin", "403"],
        ["<font face='Courier' size='8'>/api/eqs/[blogId]</font> for an unscored post",
         "404 with a message telling you to score it"],
        ["<font face='Courier' size='8'>/api/eqs/benchmark</font> as a non-admin", "403"],
        ["Voice transcribe with no provider configured",
         "503 <font face='Courier' size='8'>TRANSCRIPTION_SERVICE_UNAVAILABLE</font>"],
    ],
    widths=[52, 48],
)

h1("29. Level 5 - Behavioural tests of the principles")
para(
    "This is the level that matters most, and it needs a language model configured "
    "(check <font face='Courier' size='8'>eqsPrimaryProvider</font> first). Each test "
    "below targets one specification principle. Post each text to "
    "<font face='Courier' size='8'>/api/ai/eqs</font> and check the named field."
)
table(
    ["#", "Test", "Input", "Pass condition"],
    [
        ["1", "<b>Reasoned criticism is not abuse</b><br/>"
              "<i>The single most important test</i>",
         "A harsh but evidence-led critique. Use "
         "<font face='Courier' size='8'>eqs-crit-001</font> from the benchmark file.",
         "<font face='Courier' size='8'>toxicity</font> at or above 60, "
         "<b>no</b> <font face='Courier' size='8'>TOXICITY_CAP</font> guardrail, and the "
         "overall score stays high"],
        ["2", "Explicit abuse is caught",
         "<font face='Courier' size='8'>eqs-tox-001</font>",
         "<font face='Courier' size='8'>toxicity</font> below 35 and "
         "<font face='Courier' size='8'>TOXICITY_CAP</font> present"],
        ["3", "Sarcastic mock praise is caught",
         "<font face='Courier' size='8'>eqs-sarc-001</font>",
         "<font face='Courier' size='8'>sarcasm_intent</font> below 45; score does not "
         "read as high quality"],
        ["4", "Positive wording alone does not score well",
         "<font face='Courier' size='8'>eqs-vague-001</font>",
         "<font face='Courier' size='8'>relevance_focus</font> and "
         "<font face='Courier' size='8'>evidence_quality</font> both low; band is "
         "<font face='Courier' size='8'>below-bar</font> or "
         "<font face='Courier' size='8'>needs-work</font>"],
        ["5", "Storyteller with no statistics is not punished",
         "<font face='Courier' size='8'>eqs-hq-002</font> with "
         "<font face='Courier' size='8'>dnaOverride: {storyteller: 80, fan: 20}</font>",
         "Score stays high; <font face='Courier' size='8'>statistical_claims</font> has "
         "little weight in the blend"],
        ["6", "Fabricated statistics are contradicted",
         "<font face='Courier' size='8'>eqs-stat-001</font>. <b>Requires</b> "
         "SPORTMONKS_API_TOKEN or TAVILY_API_KEY.",
         "At least one claim with "
         "<font face='Courier' size='8'>status: contradicted</font> and a "
         "<font face='Courier' size='8'>STAT_CONTRADICTION_CAP</font> guardrail"],
        ["7", "AI-style prose is flagged but not rejected",
         "<font face='Courier' size='8'>eqs-ai-001</font>",
         "<font face='Courier' size='8'>ai_assistance</font> below 45; the penalty in "
         "<font face='Courier' size='8'>guardrails</font> is <b>at most 8 points</b>"],
        ["8", "Clean human writing is not falsely flagged as AI",
         "<font face='Courier' size='8'>eqs-ai-003</font>",
         "<font face='Courier' size='8'>ai_assistance</font> at or above 45; no AI penalty"],
        ["9", "Internal plagiarism is caught",
         "Publish <font face='Courier' size='8'>eqs-hq-001</font>, then score "
         "<font face='Courier' size='8'>eqs-copy-001</font> (a verbatim copy)",
         "<font face='Courier' size='8'>INTERNAL_EXACT_MATCH</font> flag, a "
         "<font face='Courier' size='8'>matchedPassage</font> in the evidence, and a cap"],
        ["10", "Thin content is capped",
         "A 20-word post",
         "<font face='Courier' size='8'>THIN_CONTENT_CAP</font> present, score at or "
         "below 55"],
        ["11", "Low confidence routes to review",
         "Score anything with <font face='Courier' size='8'>EQS_PROVIDER=heuristic</font>",
         "<font face='Courier' size='8'>requiresHumanReview: true</font> with a reason "
         "naming confidence"],
        ["12", "Graceful degradation",
         "Set <font face='Courier' size='8'>GEMINI_API_KEY</font> to a bad value and stop "
         "Ollama",
         "Still returns 200 with a score; confidence drops; a "
         "<font face='Courier' size='8'>LANGUAGE_ANALYSIS_FALLBACK</font> flag appears"],
    ],
    widths=[6, 23, 33, 38], bold_cols=(0,), font_scale=0.95, nowrap_cols=(0,),
)
para(
    "Sample texts for tests 1-10 are all in "
    "<font face='Courier' size='8'>src/data/eqs-benchmark.json</font> under the ids given, "
    "so you can copy them directly rather than writing your own."
)

h1("30. Level 6 - Benchmark and calibration")
para("Admin sign-in required; a full run consumes real model and search quota.")
code([
    'curl "http://localhost:3000/api/eqs/benchmark?coverage=1"        # free',
    'curl "http://localhost:3000/api/eqs/benchmark?limit=10&fast=1"   # quick smoke',
    'curl "http://localhost:3000/api/eqs/benchmark?category=sarcasm"  # one category',
    'curl "http://localhost:3000/api/eqs/benchmark"                   # full run',
])
h3("What the report tells you")
table(
    ["Field", "Meaning", "What to watch for"],
    [
        ["summary.bandAccuracy", "Share of samples landing in the right quality band",
         "Track it across changes; treat a drop as a regression"],
        ["summary.meanAbsoluteError", "Average distance from the band midpoint",
         "Lower is better"],
        ["summary.meanConfidence", "Average confidence",
         "Low values mean components are not running"],
        ["<b>criticismNotPenalised</b>",
         "Reasoned criticism not scored as abuse",
         "<b>failedIds must be empty.</b> Anything here is a direct violation of the "
         "headline principle"],
        ["detectionMetrics.*.falsePositiveRate",
         "Wrongly flagged, per signal",
         "Watch toxicity and aiAssistance especially &mdash; false positives here drive "
         "writers away"],
        ["detectionMetrics.*.falseNegativeRate", "Missed, per signal",
         "Watch toxicity and plagiarism"],
        ["observedModels", "Which models actually served the run",
         "Two reports are only comparable when this matches"],
        ["warnings", "Anything that makes the report less meaningful",
         "Read these before trusting the numbers"],
    ],
    widths=[27, 33, 40], mono_cols=(0,),
)
callout(
    "Two dataset caveats when reading a report",
    "The <font face='Courier' size='8'>copied-text</font> samples only trip plagiarism "
    "detection once their source articles are in the corpus with embeddings. The "
    "<font face='Courier' size='8'>incorrect-stats</font> samples need a cricket data or "
    "search key configured, otherwise there is no trusted source available to contradict "
    "them. Without those, the corresponding metrics will read as false negatives that are "
    "really just missing infrastructure.",
    AMBER,
)

h1("31. Level 7 - Database verification")
para("After running <font face='Courier' size='8'>/api/eqs/run</font> on a post, confirm "
     "the audit trail is real. Use <font face='Courier' size='8'>npm run db:studio</font> "
     "or SQL directly:")
code([
    "-- The run itself",
    "SELECT TOP 5 id, blogId, eqs, confidence, band, requiresHumanReview,",
    "       pipelineVersion, scoringConfigVersion, processingTimeMs",
    "FROM EqsRun ORDER BY createdAt DESC;",
    "",
    "-- Six component results per run, each with a status",
    "SELECT component, score, confidence, status, source, version, durationMs",
    "FROM EqsComponentResult WHERE runId = '<RUN_ID>';",
    "",
    "-- Claims with their verdicts and evidence",
    "SELECT claimText, claimType, status, verificationSource, provider, verifiedAt",
    "FROM EqsClaim WHERE runId = '<RUN_ID>';",
    "",
    "-- Internal and external plagiarism as separate rows",
    "SELECT kind, flagged, maxSimilarity, matchedPercent, matchedTitle",
    "FROM EqsPlagiarismResult WHERE runId = '<RUN_ID>';",
    "",
    "-- The model that produced each stage",
    "SELECT stage, provider, model, promptVersion, latencyMs, status",
    "FROM EqsModelVersion WHERE runId = '<RUN_ID>';",
    "",
    "-- The processing trail, including any failures",
    "SELECT stage, eventName, status, message, durationMs",
    "FROM EqsAuditEvent WHERE runId = '<RUN_ID>' ORDER BY createdAt;",
    "",
    "-- The DNA mix that actually drove the weighting",
    "SELECT userId, analyst, fan, storyteller, debater, source, reason",
    "FROM WriterDNAHistory ORDER BY createdAt DESC;",
    "",
    "-- Summary mirrored onto BlogScore (should match EqsRun)",
    "SELECT blogId, bqs, eqs, eqsConfidence, eqsBand, eqsRequiresReview, eqsVersion",
    "FROM BlogScore WHERE blogId = '<BLOG_ID>';",
])
para("Also confirm the self-bootstrap works: drop the EQS tables, restart the app, score "
     "something, and check they are recreated. Then confirm "
     "<font face='Courier' size='8'>npm run eqs:migration</font> regenerates "
     "<font face='Courier' size='8'>prisma/eqs_migration.sql</font> with no diff.")

h1("32. Level 8 - Voice-to-Commentary")
code([
    "# Batch transcription",
    'curl -X POST http://localhost:3000/api/commentary/transcribe \\',
    '  -F "audio=@clip.webm" -F "sessionId=<SESSION_ID>" \\',
    '  -H "Cookie: <YOUR_SESSION_COOKIE>"',
    "",
    "# Streaming credential",
    'curl -X POST http://localhost:3000/api/commentary/stt-token \\',
    '  -H "Content-Type: application/json" -d \'{"sessionId":"<SESSION_ID>"}\' \\',
    '  -H "Cookie: <YOUR_SESSION_COOKIE>"',
])
table(
    ["Check", "Pass condition"],
    [
        ["Stage latencies are reported",
         "<font face='Courier' size='8'>stages</font> has all four fields and they roughly "
         "sum to <font face='Courier' size='8'>totalMs</font>"],
        ["Latency budget is tracked",
         "<font face='Courier' size='8'>withinTarget</font> is true for a short clip; "
         "<font face='Courier' size='8'>latencyWarning</font> appears past 15s"],
        ["Player names are corrected",
         "Say a garbled surname from the session squad; the roster name comes back"],
        ["No invented names",
         "Say a name not in the squad; expect a generic role term, not a hallucinated player"],
        ["Persistence",
         "A <font face='Courier' size='8'>VoiceCommentaryJob</font> row exists with both "
         "transcripts and the timings"],
        ["Clip size guard", "A file over 12MB returns 413"],
        ["Streaming token is short-lived",
         "<font face='Courier' size='8'>expiresInSeconds</font> is around 60; the response "
         "is <font face='Courier' size='8'>Cache-Control: no-store</font>"],
        ["No provider configured",
         "Unset <font face='Courier' size='8'>DEEPGRAM_API_KEY</font> and "
         "<font face='Courier' size='8'>AI_SERVICE_URL</font>; expect a clean 503"],
    ],
    widths=[30, 70],
)

h1("33. Regression checklist")
para("Run this before changing any production model, weight, or threshold &mdash; the "
     "specification requires benchmarking before such a change, and this is that gate.")
numbered([
    "Run the full benchmark and <b>save the report</b>.",
    "Make the change in <font face='Courier' size='8'>src/data/eqs-scoring-config.json</font>.",
    "Bump <font face='Courier' size='8'>configVersion</font> in that same file.",
    "Run <font face='Courier' size='8'>npm run eqs:selftest</font> &mdash; it must pass "
    "with 0 failures.",
    "Re-run the full benchmark and compare against the saved report.",
    "Confirm <font face='Courier' size='8'>criticismNotPenalised.failedIds</font> is still "
    "empty.",
    "Confirm no detection false-positive rate got materially worse.",
    "Confirm <font face='Courier' size='8'>observedModels</font> matches the saved report, "
    "otherwise you are not comparing like with like.",
    "Only then deploy.",
])

story.append(PageBreak())

# =====================================================================
part_banner(7, "Caveats and Next Steps",
            "What you must know, and what is deliberately unfinished.")

h1("34. Three things you must know")

h2("1. The Gemini model id may not be real")
para(
    "<font face='Courier' size='8'>GEMINI_EQS_MODEL</font> defaults to "
    "<font face='Courier' size='8'>gemini-3.5-flash</font> because that is the id named in "
    "the technical specification. Google's published Flash line has used 1.5, 2.0, and 2.5 "
    "ids. If this id does not exist in your project, <b>every Gemini call fails and the "
    "pipeline silently falls back</b> to Ollama or heuristics, which will look like "
    "&ldquo;EQS works but scores are flat&rdquo; rather than like an error."
)
para("<b>Action:</b> after configuring, open "
     "<font face='Courier' size='8'>/api/health</font> and confirm "
     "<font face='Courier' size='8'>checks.eqsPrimaryProvider</font> reads "
     "<font face='Courier' size='8'>gemini</font>. Override the variable if your project "
     "exposes a different id.")

h2("2. The benchmark set has 36 samples; the specification targets 200-500")
para(
    "The harness, the metrics, and the labelling schema are complete and production-ready. "
    "Growing the set to target is <b>editorial work</b>: the specification asks for "
    "human/editorial ground truth, which is precisely the thing that cannot be generated "
    "by the system being measured without becoming circular."
)
para(
    "To extend it, append objects to "
    "<font face='Courier' size='8'>src/data/eqs-benchmark.json</font> using the existing "
    "shape. <font face='Courier' size='8'>groundTruth.band</font> is the editorial quality "
    "judgement, and the boolean fields drive the false-positive and false-negative metrics. "
    "<font face='Courier' size='8'>describeBenchmarkCoverage()</font> reports progress "
    "against the 200 target, broken down by category and by dominant DNA."
)
para("<b>This is the one part of the specification not delivered in full, and the omission "
     "is deliberate.</b>")

h2("3. Typecheck noise from a blocked Prisma download")
para(
    "During this implementation the network blocked "
    "<font face='Courier' size='8'>binaries.prisma.sh</font>, so "
    "<font face='Courier' size='8'>prisma generate</font> and "
    "<font face='Courier' size='8'>next build</font> could not run. That is why roughly 81 "
    "typecheck errors remain: every one is the same class and all resolve once the client "
    "generates. <b>Zero are in the new code.</b>"
)
h3("What was verified, and how")
table(
    ["Check", "Result"],
    [
        ["Pre-existing build-breaking bugs in scoring.ts",
         "Fixed; baseline moved from 88 to 81 errors"],
        ["Typecheck errors in new EQS or voice code", "<b>Zero</b> (verified by filter)"],
        ["ESLint across all changed files", "<b>0 errors</b> (2 pre-existing warnings, unrelated)"],
        ["Offline self-test", "<b>36 samples, 0 assertion failures</b>"],
        ["Generated SQL migration", "Regenerates from the DDL source with no diff"],
        ["Circular imports", "None introduced (verified)"],
        ["Full production build", "<b>Not verified</b> - blocked by the Prisma download"],
        ["Live model calls, real database writes",
         "<b>Not verified</b> - no keys or database available in that environment"],
    ],
    widths=[46, 54],
)
para("<b>On a machine with normal network access, run "
     "<font face='Courier' size='8'>npx prisma generate</font> and the typecheck should be "
     "clean.</b> Then work through Levels 2 to 8 of the testing guide.")

h1("35. What is left to do")
table(
    ["Item", "Why it matters", "Effort"],
    [
        ["Grow the benchmark set to 200-500 labelled samples",
         "Turns calibration from indicative into trustworthy. The gate on tuning any "
         "weight with confidence.", "Editorial"],
        ["Confirm and pin the Gemini model id",
         "Prevents a silent fallback that looks like working software.", "Minutes"],
        ["Configure an external plagiarism provider",
         "Stage 8 is the only specialist system with no live backend.", "Small"],
        ["Migrate the commentary UI to streaming STT",
         "The server side is done. This is where the real latency win is.", "Frontend"],
        ["Calibrate weights and thresholds against the grown benchmark",
         "Current values are reasoned defaults, explicitly not calibrated, exactly as the "
         "specification instructed at planning stage.", "Analysis"],
        ["Build an editor UI over the review queue",
         "The endpoint and the flagging logic exist; there is no screen yet.", "Frontend"],
        ["Add a retention policy for audit events and voice jobs",
         "Neither cascades, so both grow without bound.", "Small"],
    ],
    widths=[32, 52, 16],
)
callout(
    "A closing note on what &ldquo;done&rdquo; means here",
    "The pipeline, the specialist systems, the database design, the audit trail, the "
    "guardrails, the benchmark harness, and the voice latency instrumentation are "
    "implemented and verified to the extent the environment allowed. What is not done is "
    "<b>calibration</b> &mdash; and that is correct. The specification was explicit that "
    "exact weights and thresholds should be calibrated against an editorial benchmark "
    "rather than hard-coded at planning stage. The numbers shipped are documented, "
    "versioned, and reasoned defaults, sitting behind a harness built to replace them with "
    "measured ones.",
    GREEN,
)

story.append(PageBreak())

# =====================================================================
part_banner("A", "Reference",
            "Environment variables, commands, and troubleshooting.")

h1("A. Environment variables")
para("<font face='Courier' size='8'>.env.example</font> in the repository root is the "
     "authoritative, fully commented list. This is the summary.")
h3("Required")
table(
    ["Variable", "Purpose"],
    [
        ["DATABASE_URL", "SQL Server connection string"],
        ["AUTH_SECRET", "Session signing secret"],
        ["AUTH_URL", "Base URL of the app (AUTH_TRUST_HOST=true covers local dev)"],
    ],
    widths=[30, 70], mono_cols=(0,),
)
h3("EQS")
table(
    ["Variable", "Default", "Purpose"],
    [
        ["EQS_PROVIDER", "auto", "auto | gemini | ollama | heuristic"],
        ["GEMINI_API_KEY", "-", "Primary language-analysis model"],
        ["GEMINI_EQS_MODEL", "gemini-3.5-flash", "Model id - verify this one"],
        ["GEMINI_EQS_FAST_MODEL", "same as primary", "Cheaper model for sub-tasks"],
        ["OLLAMA_URL", "localhost:11434", "Self-hosted fallback model"],
        ["EXTERNAL_PLAGIARISM_API_URL", "-", "Stage 8; unset disables it"],
        ["INTERNAL_DUPLICATE_THRESHOLD", "0.85", "Vector similarity flag threshold"],
        ["EQS_MAX_MODEL_ADJUSTMENT", "6", "Cap on the model's influence, in points"],
        ["EQS_RUN_ON_ANALYZE", "true", "Run EQS in the publish flow"],
        ["EQS_AUTO_MIGRATE", "true", "Create EQS tables on first use"],
        ["EQS_PERSISTENCE_ENABLED", "true", "Store runs and the audit trail"],
        ["EQS_CACHE_TTL_MS", "600000", "Component result cache lifetime"],
    ],
    widths=[36, 20, 44], mono_cols=(0, 1),
)
h3("Cricket data and voice")
table(
    ["Variable", "Purpose"],
    [
        ["SPORTMONKS_API_TOKEN", "Fixtures, live scores, scorecards. Needed to verify stats"],
        ["TAVILY_API_KEY / SERPER_API_KEY",
         "Fact-check search for claims the scorecard cannot answer"],
        ["ALLOW_MOCK_MATCH_DATA", "Serve mock fixtures; keep false in production"],
        ["DEEPGRAM_API_KEY", "Speech-to-text"],
        ["VOICE_LATENCY_TARGET_MS", "End-to-end budget, default 30000"],
        ["VOICE_STREAMING_ENABLED", "Allow browser-direct streaming via a minted token"],
    ],
    widths=[34, 66], mono_cols=(0,),
)

h1("B. Command reference")
table(
    ["Command", "What it does"],
    [
        ["npm run dev", "Start the app at localhost:3000"],
        ["npm run build", "Production build (also typechecks)"],
        ["npm run typecheck", "Types only"],
        ["npm run lint", "Code style"],
        ["npm run db:push", "Create or update all database tables"],
        ["npm run db:studio", "Visual database browser at localhost:5555"],
        ["npm run eqs:selftest", "Offline scoring-engine check - no keys, no database"],
        ["npm run eqs:migration", "Regenerate prisma/eqs_migration.sql from the DDL"],
        ["npm run setup", "install + prisma generate + db push"],
        ["scripts/setup.ps1 (Windows)", "One-shot guided setup"],
        ["scripts/setup.sh (Mac / Linux)", "One-shot guided setup"],
    ],
    widths=[34, 66], mono_cols=(0,),
)

h1("C. Troubleshooting")
table(
    ["Symptom", "Cause", "Fix"],
    [
        ["npm is not recognised", "Node.js not installed, or a stale terminal",
         "Install Node LTS, reopen the terminal"],
        ["Cannot find module '@prisma/client'", "Client never generated",
         "npx prisma generate"],
        ["unable to get local issuer certificate",
         "Corporate network blocking binaries.prisma.sh",
         "Allow that host or set HTTPS_PROXY. The app still runs; EQS creates its own "
         "tables at runtime"],
        ["Can't reach database server", "SQL Server down or wrong URL",
         "Start the database, re-check DATABASE_URL"],
        ["Invalid object name 'dbo.Blog'", "Tables never created", "npm run db:push"],
        ["EADDRINUSE port 3000", "Port already in use",
         "npm run dev -- -p 3001"],
        ["<b>EQS scores all cluster around 60</b>",
         "<b>No AI model configured, so the deterministic fallback is scoring</b>",
         "Set GEMINI_API_KEY or run Ollama. Check /api/health eqsPrimaryProvider"],
        ["Stat claims never verified",
         "No cricket data source, or the post is not linked to a match",
         "Set SPORTMONKS_API_TOKEN and link a match when publishing"],
        ["Plagiarism never detected",
         "Corpus has no embeddings yet, or no external provider",
         "Publish a few posts first; set EXTERNAL_PLAGIARISM_API_URL"],
        ["Voice returns 503", "No transcription provider", "Set DEEPGRAM_API_KEY"],
        ["Blank page, chunk errors in console", "Stale build cache",
         "Delete the .next folder and restart"],
    ],
    widths=[28, 30, 42],
)

gap(14)
t = Table([[Paragraph(
    "<b>Further reading in the repository:</b> &nbsp; "
    "<font face='Courier' size='8'>SETUP.md</font> (setup cheat sheet) &nbsp;&bull;&nbsp; "
    "<font face='Courier' size='8'>docs/10-EQS.md</font> (EQS detail) &nbsp;&bull;&nbsp; "
    "<font face='Courier' size='8'>docs/11-VOICE-TO-COMMENTARY.md</font> &nbsp;&bull;&nbsp; "
    "<font face='Courier' size='8'>docs/05-DATABASE.md</font> &nbsp;&bull;&nbsp; "
    "<font face='Courier' size='8'>docs/13-CONFIGURATION.md</font> &nbsp;&bull;&nbsp; "
    "<font face='Courier' size='8'>.env.example</font>", S["td"])]],
    colWidths=[WIDTH])
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), BAND),
    ("BOX", (0, 0), (-1, -1), 0.5, RULE),
    ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 9),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
]))
story.append(t)

# ── Build ────────────────────────────────────────────────────────────
doc = Doc(OUTPUT, title="CricGeek EQS - Implementation & Technical Handover",
          author="CricGeek Network LLP", subject="EQS implementation and testing guide")
doc.build(story)
print(f"Wrote {OUTPUT}")
