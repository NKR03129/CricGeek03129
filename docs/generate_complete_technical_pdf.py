from pathlib import Path
import re
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    ListFlowable,
    ListItem,
)

DOC_ROOT = Path(__file__).resolve().parent
OUTPUT_FILE = DOC_ROOT / "CricGeek_Complete_Technical_Documentation.pdf"

# Preserve the actual source documentation created during the repo review.
DOC_SEQUENCE = [
    "00-README.md",
    "01-ARCHITECTURE.md",
    "02-PROJECT-STRUCTURE.md",
    "03-FRONTEND.md",
    "04-BACKEND.md",
    "05-DATABASE.md",
    "06-AUTHENTICATION-SECURITY.md",
    "07-API-REFERENCE.md",
    "08-PAGES.md",
    "09-FEATURES.md",
    "10-EQS.md",
    "11-VOICE-TO-COMMENTARY.md",
    "12-EXTERNAL-SERVICES.md",
    "13-CONFIGURATION.md",
    "14-DEPENDENCIES.md",
    "15-IMPLEMENTATION-STATUS.md",
    "16-KNOWN-ISSUES.md",
    "17-DEVELOPER-HANDOVER.md",
]

TITLE = "CricGeek Complete Technical Documentation"
SUBTITLE = "Developer handoff and system documentation compiled from the repository"


def inline_code(text: str) -> str:
    text = text.replace("&", "&amp;")
    text = text.replace("<", "&lt;")
    text = text.replace(">", "&gt;")
    tokens = re.split(r"`([^`]+)`", text)
    out = []
    for i, token in enumerate(tokens):
        if i % 2 == 0:
            out.append(token)
        else:
            out.append(f"<font face=\"Courier\">{token}</font>")
    return "".join(out)


def clean_markdown_for_pdf(text: str) -> str:
    text = text.replace("\r\n", "\n")
    text = text.replace("\r", "\n")
    return text


def md_to_story(file_path: Path, styles, include_toc_entry: bool = True):
    story = []
    title = file_path.stem.replace("-", " ").replace("_", " ")
    title = re.sub(r"^\d+\s*", "", title).strip()
    story.append(Paragraph(f"<b>{title}</b>", styles["docSectionTitle"]))
    story.append(Spacer(1, 8 * mm))

    content = clean_markdown_for_pdf(file_path.read_text(encoding="utf-8"))
    lines = content.splitlines()
    in_code = False
    code_buffer = []
    para_buffer = []
    list_buffer = []
    table_rows = []

    def flush_para():
        if not para_buffer:
            return
        paragraph_text = " ".join(para_buffer).strip()
        if paragraph_text:
            story.append(Paragraph(inline_code(paragraph_text), styles["docBodyText"]))
        para_buffer.clear()

    def flush_list():
        if not list_buffer:
            return
        items = [ListItem(Paragraph(inline_code(item), styles["docBodyText"])) for item in list_buffer]
        story.append(ListFlowable(items, bulletType="bullet", leftIndent=18, bulletOffsetY=0, spaceBefore=4, spaceAfter=4))
        list_buffer.clear()

    def flush_code():
        nonlocal in_code, code_buffer
        if code_buffer:
            block = "\n".join(code_buffer).strip()
            if block:
                story.append(Preformatted(block, styles["docCode"]))
            code_buffer = []
        in_code = False

    def flush_table():
        if not table_rows:
            return
        rows = []
        for row in table_rows:
            rows.append([inline_code(cell.strip()) for cell in row])
        if rows:
            table = Table(rows, repeatRows=1)
            table.hAlign = "LEFT"
            table.setStyle(
                TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ])
            )
            story.append(table)
            story.append(Spacer(1, 6 * mm))
        table_rows.clear()

    for raw in lines:
        line = raw.rstrip()

        if line.startswith("```mermaid"):
            flush_para(); flush_list(); flush_table(); flush_code()
            story.append(Paragraph("System diagram (source Mermaid diagram preserved in markdown):", styles["docSubheading"]))
            story.append(Preformatted("USER\n│\n▼\nNext.js Frontend\n│\n▼\nApp Router + API\n│\n▼\nPrisma / SQL Database\n│\n▼\nAI + Cricket + Search services", styles["docCode"]))
            continue

        if line.startswith("```"):
            flush_para(); flush_list(); flush_table()
            if in_code:
                flush_code()
            else:
                in_code = True
            continue

        if in_code:
            code_buffer.append(line)
            continue

        if re.match(r"^#{1,3}\s+", line):
            flush_para(); flush_list(); flush_table()
            level = len(line) - len(line.lstrip("#"))
            heading_text = line.lstrip("#").strip()
            if level == 1:
                story.append(Paragraph(f"<b>{inline_code(heading_text)}</b>", styles["docH1"]))
            elif level == 2:
                story.append(Paragraph(f"<b>{inline_code(heading_text)}</b>", styles["docH2"]))
            else:
                story.append(Paragraph(f"<b>{inline_code(heading_text)}</b>", styles["docH3"]))
            story.append(Spacer(1, 2 * mm))
            continue

        if re.match(r"^\s*[-*]\s+", line):
            flush_para(); flush_table()
            list_buffer.append(line[2:].strip())
            continue

        if line.startswith("|") and "|" in line and not line.startswith("|---"):
            flush_para(); flush_list()
            cells = [cell.strip() for cell in line.split("|")[1:-1]]
            if cells:
                table_rows.append(cells)
            continue

        if line.startswith("|---") or line.startswith("---"):
            continue

        if not line.strip():
            flush_para(); flush_list(); flush_table();
            continue

        para_buffer.append(line.strip())

    flush_para(); flush_list(); flush_table(); flush_code()
    story.append(Spacer(1, 8 * mm))
    return story


def build_toc_titles():
    toc = [
        "1. Executive overview",
        "2. Architecture",
        "3. Project structure",
        "4. Frontend architecture",
        "5. Backend architecture",
        "6. Database and schema",
        "7. Authentication and security",
        "8. API reference",
        "9. Pages",
        "10. Features",
        "11. EQS",
        "12. Voice-to-Commentary",
        "13. External services",
        "14. Configuration",
        "15. Dependencies",
        "16. Implementation status",
        "17. Known issues",
        "18. Developer handoff",
    ]
    return toc


def unique_title_for_file(file_name: str) -> str:
    mapping = {
        "00-README.md": "Executive overview",
        "01-ARCHITECTURE.md": "Architecture",
        "02-PROJECT-STRUCTURE.md": "Project structure",
        "03-FRONTEND.md": "Frontend architecture",
        "04-BACKEND.md": "Backend architecture",
        "05-DATABASE.md": "Database and schema",
        "06-AUTHENTICATION-SECURITY.md": "Authentication and security",
        "07-API-REFERENCE.md": "API reference",
        "08-PAGES.md": "Pages",
        "09-FEATURES.md": "Features",
        "10-EQS.md": "EQS",
        "11-VOICE-TO-COMMENTARY.md": "Voice-to-Commentary",
        "12-EXTERNAL-SERVICES.md": "External services",
        "13-CONFIGURATION.md": "Configuration",
        "14-DEPENDENCIES.md": "Dependencies",
        "15-IMPLEMENTATION-STATUS.md": "Implementation status",
        "16-KNOWN-ISSUES.md": "Known issues",
        "17-DEVELOPER-HANDOVER.md": "Developer handoff",
    }
    return mapping.get(file_name, file_name)


def build_pdf():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(name="docTitleLarge", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=24, leading=28, spaceAfter=16, textColor=colors.HexColor("#0F172A")))
    styles.add(ParagraphStyle(name="docSubtitle", parent=styles["BodyText"], fontName="Helvetica", fontSize=11, leading=15, spaceAfter=20, textColor=colors.HexColor("#334155")))
    styles.add(ParagraphStyle(name="docCoverMeta", parent=styles["BodyText"], fontName="Courier", fontSize=9, leading=12, textColor=colors.HexColor("#475569")))
    styles.add(ParagraphStyle(name="docSectionTitle", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=16, leading=18, spaceBefore=8, spaceAfter=8, textColor=colors.HexColor("#0F172A")))
    styles.add(ParagraphStyle(name="docH1", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=14, leading=18, spaceBefore=10, spaceAfter=6, textColor=colors.HexColor("#0F172A")))
    styles.add(ParagraphStyle(name="docH2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=14, spaceBefore=8, spaceAfter=4, textColor=colors.HexColor("#0F172A")))
    styles.add(ParagraphStyle(name="docH3", parent=styles["Heading3"], fontName="Helvetica-Bold", fontSize=10.5, leading=12.5, spaceBefore=6, spaceAfter=2, textColor=colors.HexColor("#0F172A")))
    styles.add(ParagraphStyle(name="docBodyText", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.5, leading=13.5, spaceAfter=4, textColor=colors.HexColor("#1E293B")))
    styles.add(ParagraphStyle(name="docSubheading", parent=styles["Heading3"], fontName="Helvetica-Bold", fontSize=10.5, leading=12.5, spaceBefore=4, spaceAfter=2, textColor=colors.HexColor("#0F172A")))
    styles.add(ParagraphStyle(name="docCode", parent=styles["Code"], fontName="Courier", fontSize=8.2, leading=10.5, backColor=colors.HexColor("#F8FAFC"), borderColor=colors.HexColor("#CBD5E1"), borderPadding=6, borderWidth=0.5))

    def footer(canvas, doc):
        page_num = canvas.getPageNumber()
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#475569"))
        canvas.drawRightString(doc.width + doc.leftMargin - 10, 15, f"Page {page_num}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        str(OUTPUT_FILE),
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=20 * mm,
        title="CricGeek Complete Technical Documentation",
        author="CricGeek project documentation",
    )
    doc.allowSplitting = True
    doc.building = []

    story = []
    story.append(Spacer(1, 20 * mm))
    story.append(Paragraph(TITLE, styles["docTitleLarge"]))
    story.append(Paragraph(SUBTITLE, styles["docSubtitle"]))
    story.append(Spacer(1, 10 * mm))
    story.append(Paragraph("Compiled from the repository and supporting markdown documentation.", styles["docCoverMeta"]))
    story.append(Paragraph("Prepared for: developer handoff and technical onboarding", styles["docCoverMeta"]))
    story.append(Paragraph(f"Prepared: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}", styles["docCoverMeta"]))
    story.append(Spacer(1, 14 * mm))

    overview_table = Table(
        [
            ["Document scope", "Repository-backed, full technical system documentation"],
            ["Primary stack", "Next.js 16, React 19, TypeScript, Prisma, SQL Server, NextAuth, Python AI services"],
            ["Core concerns", "Match data, writer system, AI scoring, contests, commentary, auth, fact-checking"],
            ["Primary runtime", "Node.js app runtime; AI tooling and Python services are external dependencies"],
        ],
        colWidths=[48 * mm, 110 * mm],
    )
    overview_table.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ])
    )
    story.append(overview_table)
    story.append(PageBreak())

    story.append(Paragraph("Table of contents", styles["docSectionTitle"]))
    story.append(Spacer(1, 4 * mm))
    for index, file_name in enumerate(DOC_SEQUENCE, start=1):
        title = unique_title_for_file(file_name)
        story.append(Paragraph(f"{index}. {title}", styles["docBodyText"]))
    story.append(PageBreak())

    for file_name in DOC_SEQUENCE:
        file_path = DOC_ROOT / file_name
        if not file_path.exists():
            continue
        story.extend(md_to_story(file_path, styles))
        story.append(PageBreak())

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


if __name__ == "__main__":
    build_pdf()
    print(f"PDF generated: {OUTPUT_FILE}")
