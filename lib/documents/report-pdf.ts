import PDFDocument from "pdfkit";
import path from "node:path";
import { access } from "node:fs/promises";
import type { DailyReport, ReportLine } from "../domain/types.ts";
import { DocumentError } from "./types.ts";

/** Render an already authorized immutable report revision. No live stock is read here. */
export async function renderReportPdf(report: DailyReport): Promise<Buffer> {
  const businessName = report.businessName || "Business name not captured";
  const timezone = report.timezone || "UTC";
  const fonts = path.resolve(
    process.env.REPORT_FONT_PATH ||
      path.join(process.cwd(), "runtime", "fonts"),
  );
  const regular = path.join(fonts, "DejaVuSans.ttf"),
    bold = path.join(fonts, "DejaVuSans-Bold.ttf");
  try {
    await Promise.all([access(regular), access(bold)]);
  } catch {
    throw new DocumentError(
      "Report fonts are missing. Restore the bundled runtime/fonts files.",
      "PDF_FONT_MISSING",
      503,
    );
  }
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: 34, left: 36, right: 36, bottom: 44 },
    bufferPages: true,
    info: {
      Title: `${report.vehicleName} · ${report.day} · revision ${report.revision}`,
      Author: businessName,
      Subject: "Immutable daily vehicle stock report",
      Keywords: "daily report, inventory, approved revision",
    },
  });
  doc.registerFont("body", regular).registerFont("bold", bold);
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const left = 36,
    width = doc.page.width - 72,
    bottom = doc.page.height - 51;
  const navy = "#253449",
    teal = "#327775",
    muted = "#56667B",
    light = "#EFF3F6",
    line = "#D4DDE5";
  let y = 34;
  const time = (value: string | null) => {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isFinite(d.getTime())
      ? new Intl.DateTimeFormat("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: timezone,
        }).format(d)
      : value;
  };
  const small = (text: string, x: number, top: number, w: number) =>
    doc
      .font("body")
      .fontSize(8.2)
      .fillColor(muted)
      .text(text, x, top, { width: w, lineGap: 2 });
  function heading(continued = false) {
    doc
      .font("bold")
      .fontSize(11)
      .fillColor(teal)
      .text(businessName, left, 28, {
        width: width - 170,
        height: 16,
        ellipsis: true,
      });
    doc
      .font("bold")
      .fontSize(continued ? 17 : 23)
      .fillColor(navy)
      .text("Daily vehicle report", left, continued ? 48 : 49, {
        width: width - 170,
      });
    doc
      .font("bold")
      .fontSize(10)
      .fillColor(navy)
      .text(report.status.replaceAll("_", " "), left + width - 170, 30, {
        width: 170,
        align: "right",
      });
    small(
      `Revision ${report.revision} · ${report.day}`,
      left + width - 170,
      47,
      170,
    );
    if (continued) {
      small(`${report.vehicleName} · ${report.salesmanName}`, left, 72, width);
      y = 99;
      return;
    }
    y = 91;
    const fields = [
      ["Vehicle", report.vehicleName],
      ["Salesman", report.salesmanName],
      ["Business day", report.day],
      ["Godown", report.warehouseName || "Not captured in this revision"],
      ["Location", report.locationName || "Not captured in this revision"],
      ["Timezone", report.timezone || "UTC (original timezone not captured)"],
      ["Submitted", time(report.submittedAt)],
      ["Decision by", report.decidedBy || "Awaiting decision"],
      ["Decision time", time(report.decidedAt)],
    ];
    for (let i = 0; i < fields.length; i += 3) {
      const row = fields.slice(i, i + 3),
        cellWidth = width / 3 - 12;
      doc.font("body").fontSize(9);
      const rowHeight = Math.max(
        36,
        ...row.map(
          ([, value]) =>
            doc.heightOfString(value, { width: cellWidth, lineGap: 1 }) + 20,
        ),
      );
      row.forEach(([label, value], col) => {
        const x = left + col * (width / 3);
        small(label.toUpperCase(), x, y, cellWidth);
        doc
          .font("body")
          .fontSize(9)
          .fillColor(navy)
          .text(value, x, y + 12, { width: cellWidth, lineGap: 1 });
      });
      y += rowHeight;
    }
    small(
      `Report ${report.id} · Revision record ${report.revisionId}`,
      left,
      y,
      width,
    );
    y += 22;
  }
  const widths = [196, 62, 62, 62, 72, 90, width - 544];
  const labels = [
    "Product",
    "Opening\nbase",
    "Loaded\nbase",
    "Sold\nbase",
    "Reversed\nbase",
    "Adjustments\nbase",
    "Closing stock",
  ];
  function tableHead() {
    doc.rect(left, y, width, 32).fill(navy);
    let x = left;
    labels.forEach((label, i) => {
      doc
        .font("bold")
        .fontSize(8.2)
        .fillColor("#FFFFFF")
        .text(label, x + 8, y + 7, {
          width: widths[i] - 16,
          align: i > 0 && i < 6 ? "right" : "left",
          lineGap: 1,
        });
      x += widths[i];
    });
    y += 32;
  }
  function space(height: number, table = false) {
    if (y + height <= bottom) return;
    doc.addPage();
    heading(true);
    if (table) tableHead();
  }
  function paragraph(label: string, text: string) {
    if (!text) return;
    doc.font("body").fontSize(9);
    const h = doc.heightOfString(text, { width, lineGap: 3 }) + 30;
    space(h);
    doc
      .font("bold")
      .fontSize(10)
      .fillColor(navy)
      .text(label, left, y, { width });
    y += 17;
    doc
      .font("body")
      .fontSize(9)
      .fillColor(muted)
      .text(text, left, y, { width, lineGap: 3 });
    y = doc.y + 16;
  }
  heading();
  small(
    "Movement columns show canonical base quantities. Closing uses the packaging saved with this report revision.",
    left,
    y,
    width,
  );
  y += 25;
  tableHead();
  for (const [index, row] of report.lines.entries()) {
    const closing = `${row.formatted}\n${row.closing.toLocaleString("en-IN")} ${row.baseUnit} (base)`;
    doc.font("body").fontSize(9);
    const h = Math.max(
      43,
      doc.heightOfString(row.productName, {
        width: widths[0] - 16,
        lineGap: 2,
      }) + 17,
      doc.heightOfString(closing, { width: widths[6] - 16, lineGap: 2 }) + 17,
    );
    space(h, true);
    if (index % 2 === 0) doc.rect(left, y, width, h).fill(light);
    let x = left;
    const values = [
      row.productName,
      row.opening.toLocaleString("en-IN"),
      row.loaded.toLocaleString("en-IN"),
      row.sold.toLocaleString("en-IN"),
      row.reversed.toLocaleString("en-IN"),
      row.adjustments.toLocaleString("en-IN"),
      closing,
    ];
    values.forEach((value, i) => {
      doc
        .font(i === 6 ? "bold" : "body")
        .fontSize(i === 6 ? 8.6 : 9)
        .fillColor(navy)
        .text(value, x + 8, y + 8, {
          width: widths[i] - 16,
          align: i > 0 && i < 6 ? "right" : "left",
          lineGap: 2,
        });
      x += widths[i];
    });
    doc
      .moveTo(left, y + h)
      .lineTo(left + width, y + h)
      .strokeColor(line)
      .lineWidth(0.5)
      .stroke();
    y += h;
  }
  if (!report.lines.length) {
    space(40);
    small(
      "No stock movements were present in this saved report.",
      left,
      y + 12,
      width,
    );
    y += 40;
  }
  y += 18;
  paragraph("Report notes", report.notes || "No submission notes.");
  paragraph(
    "Decision / review",
    report.decisionReason ||
      `Status: ${report.status}. ${report.decidedBy ? `Decision by ${report.decidedBy} at ${time(report.decidedAt)}.` : "No administrator decision has been recorded."}`,
  );
  space(95);
  doc
    .font("bold")
    .fontSize(11)
    .fillColor(navy)
    .text("Saved packaging definitions", left, y);
  y += 22;
  const definitions = new Map<string, ReportLine>();
  for (const row of report.lines)
    definitions.set(`${row.productId}:${row.packagingId}`, row);
  for (const row of definitions.values()) {
    const ratios = row.levels
      .map(
        (l) =>
          `1 ${l.label} = ${l.factor.toLocaleString("en-IN")} ${row.baseUnit}`,
      )
      .join(" · ");
    const content = `${row.productName}\n${ratios || "No packaging definition saved."}\nPackaging record: ${row.packagingId || "unconfigured"}`;
    doc.font("body").fontSize(8.2);
    const h = doc.heightOfString(content, { width, lineGap: 3 }) + 14;
    space(h);
    doc.fillColor(muted).text(content, left, y, { width, lineGap: 3 });
    y = doc.y + 14;
  }
  const amendments = report.amendments || [];
  if (amendments.length) {
    space(100);
    doc
      .font("bold")
      .fontSize(11)
      .fillColor(navy)
      .text("Saved correction annotations", left, y);
    y += 22;
    for (const raw of amendments) {
      const a =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      paragraph(
        String(a.reference || "Correction"),
        [
          a.day,
          a.originalReference ? `Original: ${a.originalReference}` : "",
          a.reason,
        ]
          .filter(Boolean)
          .map(String)
          .join(" · "),
      );
    }
  }
  paragraph(
    "Snapshot integrity",
    `Source hash: ${report.sourceHash}\nThis PDF reproduces the selected saved revision. Later stock movements and packaging changes do not recalculate its quantities. Times use ${timezone}.`,
  );
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    // Footer text is intentionally below the content margin. Temporarily permit
    // that area so PDFKit cannot append blank pages while writing page numbers.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const top = doc.page.height - 28;
    doc
      .moveTo(left, top - 7)
      .lineTo(left + width, top - 7)
      .strokeColor(line)
      .lineWidth(0.5)
      .stroke();
    doc
      .font("body")
      .fontSize(7.5)
      .fillColor(muted)
      .text(
        `${report.day} · ${report.vehicleName} · revision ${report.revision}`,
        left,
        top,
        { width: width - 110, lineBreak: false },
      );
    doc.text(`Page ${p + 1} of ${range.count}`, left + width - 110, top, {
      width: 110,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = savedBottom;
  }
  doc.end();
  return complete;
}
