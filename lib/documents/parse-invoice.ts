import type { Product } from "../domain/types.ts";
import { createProductMatcher } from "./matching.ts";
import type { InvoiceCandidate, InvoiceExtraction } from "./types.ts";

type Column =
  | "description"
  | "code"
  | "quantity"
  | "unit"
  | "free"
  | "price"
  | "amount"
  | "ignore";
function column(value: string): Column {
  const v = value.toLowerCase().replace(/[^a-z]/g, "");
  if (
    /^(description|particulars?|products?|items?|itemdescription|productname|itemname)$/.test(
      v,
    )
  )
    return "description";
  if (/^(sku|code|itemcode|productcode)$/.test(v)) return "code";
  if (/^(qty|quantity|billedqty|invoiceqty|billedquantity)$/.test(v))
    return "quantity";
  if (/^(uom|unit|units)$/.test(v)) return "unit";
  if (/^(free|freeqty|freequantity|bonusqty)$/.test(v)) return "free";
  if (/^(rate|price|unitprice)$/.test(v)) return "price";
  if (/^(amount|value|lineamount|total)$/.test(v)) return "amount";
  return "ignore";
}
function splitRow(line: string) {
  return line.includes("|")
    ? line
        .split("|")
        .map((v) => v.trim())
        .filter((v, i, a) => v || (i > 0 && i < a.length - 1))
    : line.trim().split(/\t+|\s{2,}/);
}
function numeric(value: string | undefined): number | null {
  if (!value || !/^\d+(?:,\d{3})*(?:\.\d+)?$/.test(value.trim())) return null;
  const n = Number(value.replaceAll(",", ""));
  return Number.isFinite(n) && n <= Number.MAX_SAFE_INTEGER ? n : null;
}
function money(value: string | undefined): string | null {
  return value && numeric(value.replace(/^(?:INR|Rs\.?|₹)\s*/i, "")) !== null
    ? value.trim()
    : null;
}
function isoDate(raw: string) {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  // Numeric slash dates are deliberately left unresolved (DD/MM vs MM/DD).
  const named = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/);
  let value = "";
  if (iso) value = iso[0];
  if (named) {
    const month =
      [
        "jan",
        "feb",
        "mar",
        "apr",
        "may",
        "jun",
        "jul",
        "aug",
        "sep",
        "oct",
        "nov",
        "dec",
      ].indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    if (month)
      value = `${named[3]}-${String(month).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
  }
  return value &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
    ? value
    : "";
}
/** Deterministic evidence extraction. Text has no execution authority and is never sent to a posting action. */
export function parseInvoiceText(
  pageTexts: string[],
  products: Product[],
  engines: string[] = ["text"],
): InvoiceExtraction {
  const text = pageTexts.join("\n\f\n").slice(0, 1_000_000);
  const warnings: string[] = [
    "Every extracted field, product match, unit and physically received quantity requires administrator confirmation.",
  ];
  const supplier =
    text
      .match(
        /(?:^|\n)\s*(?:supplier|vendor|sold by)\s*[:\-]\s*([^\n\r]+)/i,
      )?.[1]
      .trim() || "";
  const invoiceNumber =
    text.match(
      /\binvoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([^\s|:]{1,80})/i,
    )?.[1] || "";
  const dateRaw =
    text
      .match(/\b(?:invoice\s*date|date)\s*[:\-]\s*([^\n\r|]+)/i)?.[1]
      .trim()
      .split(/\s{2,}/)[0] || "";
  const invoiceDate = isoDate(dateRaw);
  if (!supplier)
    warnings.push(
      "Supplier was not explicitly labeled; enter it from the document.",
    );
  if (!invoiceNumber) warnings.push("Invoice number is missing or unclear.");
  else if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(invoiceNumber))
    warnings.push(
      "Invoice number contains unusual OCR characters. Verify every character against the original.",
    );
  if (!invoiceDate)
    warnings.push(
      dateRaw
        ? `Invoice date "${dateRaw}" needs confirmation; ambiguous numeric dates are not interpreted.`
        : "Invoice date is missing.",
    );
  const taxIdentifier =
    text.match(
      /\b(?:GSTIN|GST\s*(?:No\.?|Number))\s*[:\-]?\s*([0-9A-Z]{15})\b/i,
    )?.[1] || "";
  const match = createProductMatcher(products),
    suggestions: InvoiceCandidate[] = [];
  pageTexts.forEach((pageText, page) => {
    let header: Column[] | null = null;
    pageText.split(/\r?\n/).forEach((source, lineIndex) => {
      if (!source.trim() || suggestions.length >= 500) return;
      const cells = splitRow(source),
        mapped = cells.map(column);
      if (mapped.includes("description") && mapped.includes("quantity")) {
        header = mapped;
        return;
      }
      if (
        /^\s*(?:sub\s*total|grand\s*total|total|tax|cgst|sgst|igst|round\s*off|discount|amount\s*in\s*words)\b/i.test(
          source,
        )
      ) {
        header = null;
        return;
      }
      const raw: Record<string, string> = {};
      let description = "",
        quantity: number | null = null,
        unit: string | null = null;
      if (header && cells.length === header.length) {
        header.forEach((key, i) => {
          if (key !== "ignore") raw[key] = cells[i];
        });
        description = raw.description || "";
        const quantityAndUnit = raw.quantity?.match(
          /^(\d+(?:,\d{3})*(?:\.\d+)?)\s+([\p{L}][\p{L} .-]*)$/u,
        );
        quantity = numeric(quantityAndUnit?.[1] || raw.quantity);
        unit = raw.unit || quantityAndUnit?.[2] || null;
      } else {
        // Only explicit quantity labels are interpreted when the table layout is unknown.
        const explicit = source.match(
          /^\s*(.+?)\s+(?:qty|quantity)\s*[:=]\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)?(?:\s+free\s*[:=]\s*(\d+(?:\.\d+)?))?/i,
        );
        if (!explicit) return;
        description = explicit[1];
        quantity = numeric(explicit[2]);
        unit = explicit[3] || null;
        raw.description = description;
        raw.quantity = explicit[2];
        raw.unit = unit || "";
        if (explicit[4]) raw.free = explicit[4];
      }
      if (
        !description ||
        !/[\p{L}]/u.test(description) ||
        /^(?:invoice|supplier|vendor|date|address|bill to|ship to)\s*:/i.test(
          description,
        )
      )
        return;
      const issues: string[] = [];
      if (quantity === null)
        issues.push("Billed quantity is missing or ambiguous.");
      else if (!Number.isSafeInteger(quantity))
        issues.push(
          "Fractional quantity cannot be posted as a discrete stock unit.",
        );
      if (!unit)
        issues.push(
          "Invoice unit is missing; no packaging ratio has been inferred.",
        );
      const freeQuantity = numeric(raw.free);
      if (raw.free && freeQuantity === null)
        issues.push("Free quantity is ambiguous.");
      const matches = match(description, unit, raw.code || null);
      if (!matches.length) issues.push("No product match was found.");
      else if (matches[0].confidence !== "high")
        issues.push("Product match is uncertain.");
      suggestions.push({
        description,
        productCode: raw.code || null,
        billedQuantity: quantity,
        unit,
        freeQuantity,
        unitPrice: money(raw.price),
        amount: money(raw.amount),
        evidence: {
          page: page + 1,
          line: lineIndex + 1,
          text: source.slice(0, 2000),
        },
        raw,
        matches,
        issues,
        requiresConfirmation: true,
      });
    });
  });
  if (!suggestions.length)
    warnings.push(
      "No reliably labeled item table was recognized. Use the source preview and enter lines manually.",
    );
  if (suggestions.length === 500)
    warnings.push(
      "Candidate line limit reached; inspect the original for additional items.",
    );
  return {
    extractionStatus: "COMPLETED",
    extractionError: "",
    extractedText: text,
    supplier,
    invoiceNumber,
    invoiceDate,
    taxIdentifier,
    suggestions,
    warnings,
    pages: pageTexts.length,
    engines,
  };
}
