// Export files (server only): Excel, PDF, CSV and Word from one ExportTable.

import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell,
  TableRow, TextRun, WidthType,
} from "docx";
import type { ExportFormat } from "@/lib/exportColumns";
import type { Cell, ExportTable } from "@/lib/exportData";

export const MIME: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** PDF and Word get very slow and unreadable past this many rows; Excel / CSV take everything. */
export const PRINT_LIMIT = 3000;

const SITE = "Obesity Trials Intelligence";
const text = (v: Cell) => (v === null || v === undefined ? "" : String(v));
/** The built-in PDF fonts only know Western characters: swap the common others, drop the rest. */
const pdfText = (s: string) => s
  .replace(/[\u2212\u2013]/g, "-").replace(/\u2265/g, ">=").replace(/\u2264/g, "<=").replace(/[\u2192\u27f6]/g, "->")
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, "...").replace(/\u00b7/g, "·")
  .replace(/[^\x00-\xff\u2014\u20ac]/g, "");

export function fileName(t: ExportTable, fmt: ExportFormat, when = new Date()): string {
  const d = when.toISOString().slice(0, 10);
  return `obesity-${t.dataset}-${d}.${fmt}`;
}

function header(t: ExportTable, user: string, when: Date): string[] {
  return [
    `${SITE} — ${t.title}`,
    `Exported ${when.toISOString().replace("T", " ").slice(0, 16)} UTC by ${user}`,
    `Rows: ${t.rows.length.toLocaleString("en-US")}${t.truncated ? " (stopped at the export limit)" : ""}`,
    `Filters: ${t.filters.join(" · ")}`,
  ];
}

// ---------------------------------------------------------------- CSV
function csv(t: ExportTable): Buffer {
  const esc = (v: Cell) => {
    const s = text(v);
    // a leading = + - @ would be run as a formula by spreadsheet apps
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [t.columns.map((c) => esc(c.label)).join(","), ...t.rows.map((r) => r.map(esc).join(","))];
  return Buffer.from("﻿" + lines.join("\r\n"), "utf8"); // BOM: Excel opens UTF-8 correctly
}

// ---------------------------------------------------------------- Excel
async function xlsx(t: ExportTable, user: string, when: Date): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = SITE;
  wb.created = when;
  const ws = wb.addWorksheet(t.dataset === "trials" ? "Trials" : "Drugs", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = t.columns.map((c) => ({ header: c.label, key: c.key, width: Math.round(10 + (c.width ?? 1.5) * 9) }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E7490" } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 30;
  for (const r of t.rows) {
    const row = ws.addRow(r.map((v, i) => {
      const c = t.columns[i];
      if (v === null || v === undefined || v === "") return null;
      if (c.link && typeof v === "string") return { text: v, hyperlink: v };
      if (c.number && typeof v === "number") return v;
      return String(v);
    }));
    row.alignment = { vertical: "top", wrapText: true };
  }
  t.columns.forEach((c, i) => {
    if (c.link) ws.getColumn(i + 1).font = { color: { argb: "FF0369A1" }, underline: true };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };

  const about = wb.addWorksheet("About this export");
  about.columns = [{ width: 24 }, { width: 100 }];
  const [title, exported, rows, filters] = header(t, user, when);
  about.addRow(["Export", title]).font = { bold: true };
  about.addRow(["Exported", exported.replace(/^Exported /, "")]);
  about.addRow(["Rows", rows.replace(/^Rows: /, "")]);
  about.addRow(["Filters", filters.replace(/^Filters: /, "")]);
  about.addRow(["Columns", t.columns.map((c) => c.label).join(", ")]);
  about.addRow([]);
  about.addRow(["Source", "ClinicalTrials.gov (synced daily), company and regulator sources, research files — see each drug page for its sources."]);
  for (const s of t.summary) {
    about.addRow([]);
    about.addRow([s.label]).font = { bold: true };
    for (const it of s.items) about.addRow([it.label, it.value]);
  }
  about.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- PDF
function pdf(t: ExportTable, user: string, when: Date): Buffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const [title, exported, rows, filters] = header(t, user, when);
  doc.setFontSize(15).setFont("helvetica", "bold").text(pdfText(title), 36, 40);
  doc.setFontSize(9).setFont("helvetica", "normal").setTextColor(90);
  doc.text(doc.splitTextToSize(pdfText(`${exported}  ·  ${rows}`), 770), 36, 58);
  const fl = doc.splitTextToSize(pdfText(filters), 770);
  doc.text(fl, 36, 72);
  const limited = t.rows.slice(0, PRINT_LIMIT);
  const totalW = t.columns.reduce((s, c) => s + (c.width ?? 1.5), 0);
  const avail = 842 - 72;
  autoTable(doc, {
    startY: 72 + fl.length * 11 + 8,
    head: [t.columns.map((c) => pdfText(c.label))],
    body: limited.map((r) => r.map((v) => pdfText(text(v)))),
    styles: { fontSize: t.columns.length > 10 ? 6.5 : 7.5, cellPadding: 3, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: [14, 116, 144], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 248, 250] },
    columnStyles: Object.fromEntries(t.columns.map((c, i) => [i, { cellWidth: ((c.width ?? 1.5) / totalW) * avail }])),
    margin: { left: 36, right: 36, top: 36, bottom: 30 },
    didDrawPage: () => {
      doc.setFontSize(7.5).setTextColor(130);
      const n = doc.getNumberOfPages();
      doc.text(`${SITE} · ${t.title} · page ${n}`, 36, 595 - 14);
    },
  });
  if (t.rows.length > PRINT_LIMIT) {
    doc.addPage();
    doc.setFontSize(10).setTextColor(60).text(
      `The PDF shows the first ${PRINT_LIMIT.toLocaleString("en-US")} of ${t.rows.length.toLocaleString("en-US")} rows. Download Excel or CSV for every row.`, 36, 50);
  }
  return Buffer.from(doc.output("arraybuffer"));
}

// ---------------------------------------------------------------- Word
async function docx(t: ExportTable, user: string, when: Date): Promise<Buffer> {
  const [title, exported, rows, filters] = header(t, user, when);
  const limited = t.rows.slice(0, PRINT_LIMIT);
  const totalW = t.columns.reduce((s, c) => s + (c.width ?? 1.5), 0);
  const border = { style: BorderStyle.SINGLE, size: 2, color: "D5DCE3" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const size = t.columns.length > 10 ? 13 : 15; // half-points
  const cell = (v: string, headCell = false, w = 1) => new TableCell({
    borders,
    width: { size: Math.round((w / totalW) * 100), type: WidthType.PERCENTAGE },
    shading: headCell ? { type: ShadingType.CLEAR, color: "auto", fill: "0E7490" } : undefined,
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: [new Paragraph({ children: [new TextRun({ text: v, bold: headCell, color: headCell ? "FFFFFF" : "1F2937", size })] })],
  });
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: t.columns.map((c) => cell(c.label, true, c.width ?? 1.5)) }),
      ...limited.map((r) => new TableRow({ children: r.map((v, i) => cell(text(v), false, t.columns[i].width ?? 1.5)) })),
    ],
  });
  const small = (s: string) => new Paragraph({ children: [new TextRun({ text: s, size: 18, color: "555555" })] });
  const doc = new Document({
    creator: SITE, title,
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: title })] }),
        small(exported), small(rows), small(filters),
        new Paragraph({ text: "" }),
        table,
        ...(t.rows.length > PRINT_LIMIT ? [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({
          text: `Shows the first ${PRINT_LIMIT.toLocaleString("en-US")} of ${t.rows.length.toLocaleString("en-US")} rows — download Excel or CSV for every row.`, italics: true, size: 18 })] })] : []),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function makeFile(t: ExportTable, fmt: ExportFormat, user: string, when = new Date()): Promise<Buffer> {
  switch (fmt) {
    case "csv": return csv(t);
    case "xlsx": return xlsx(t, user, when);
    case "pdf": return pdf(t, user, when);
    case "docx": return docx(t, user, when);
  }
}
