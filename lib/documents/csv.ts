import { createHash } from "node:crypto";
import type { Product, UnitLevel } from "../domain/types.ts";
import { DocumentError } from "./types.ts";
import { normalize } from "./matching.ts";

export type CsvRecord = { rowNumber: number; cells: string[] };
export type ImportField =
  | "id"
  | "sku"
  | "name"
  | "category"
  | "packaging"
  | "warehouseQuantity"
  | "price"
  | "minStock"
  | "active"
  | "currency"
  | "priceUnit"
  | "baseUnit"
  | "levels"
  | "packagingVersion";
export type ColumnMapping = Partial<Record<ImportField, string>>;
export type ImportIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
};
export type ProductImportRow = {
  rowNumber: number;
  raw: Record<string, string>;
  fingerprint: string;
  product: {
    id?: string;
    sku?: string;
    name: string;
    category: string;
    active: boolean;
    minStock: number;
    price: string | null;
    currency: string;
    priceUnit: string | null;
    rawImport: Record<string, string>;
  };
  sourceStockQuantity: number | null;
  packagingRaw: string;
  packaging: {
    baseUnit: string;
    levels: UnitLevel[];
    sourceVersion: string;
  } | null;
  issues: ImportIssue[];
  candidates: { id: string; name: string; reason: string }[];
};
export type ProductImportPreview = {
  headers: string[];
  mapping: ColumnMapping;
  rows: ProductImportRow[];
  errors: string[];
  warnings: string[];
  fileHash: string;
};
export type ImportDecision = {
  rowNumber: number;
  action: "create" | "update" | "skip";
  productId?: string;
  confirmPrice?: boolean;
  currency?: string;
  priceUnit?: string;
  confirmMinimumStock?: boolean;
};
export type PreparedProductImport = ProductImportRow["product"];
const MAX_CSV_BYTES = 5 * 1024 * 1024;
/** RFC 4180 quoting, embedded CRLF/newlines, UTF-8 BOM, exact raw values and source line numbers. */
export function parseCsv(input: string): CsvRecord[] {
  if (Buffer.byteLength(input, "utf8") > MAX_CSV_BYTES)
    throw new DocumentError("CSV is limited to 5 MB.", "CSV_SIZE", 413);
  const text = input.replace(/^\uFEFF/, "");
  const rows: CsvRecord[] = [];
  let cells: string[] = [],
    value = "",
    quoted = false,
    closed = false,
    line = 1,
    rowLine = 1;
  const pushCell = () => {
    cells.push(value);
    value = "";
    closed = false;
    if (cells.length > 100)
      throw new DocumentError("CSV has more than 100 columns.", "CSV_COLUMNS");
  };
  const pushRow = () => {
    pushCell();
    if (cells.some((c) => c !== "")) rows.push({ rowNumber: rowLine, cells });
    cells = [];
    if (rows.length > 5001)
      throw new DocumentError(
        "CSV has more than 5,000 product rows.",
        "CSV_ROWS",
      );
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        value += char;
        if (char === "\n") line++;
        else if (char === "\r" && text[i + 1] !== "\n") line++;
      }
      continue;
    }
    if (char === '"') {
      if (value || closed)
        throw new DocumentError(
          `Unexpected quote on CSV line ${line}.`,
          "CSV_QUOTE",
        );
      quoted = true;
    } else if (char === ",") pushCell();
    else if (char === "\r" || char === "\n") {
      pushRow();
      if (char === "\r" && text[i + 1] === "\n") i++;
      line++;
      rowLine = line;
    } else {
      if (closed)
        throw new DocumentError(
          `Unexpected characters after closing quote on CSV line ${line}.`,
          "CSV_QUOTE",
        );
      value += char;
    }
  }
  if (quoted)
    throw new DocumentError(
      `Unclosed quoted value on CSV line ${rowLine}.`,
      "CSV_QUOTE",
    );
  if (value || closed || cells.length) pushRow();
  return rows;
}
const aliases: Record<ImportField, string[]> = {
  id: ["Product ID", "ID"],
  sku: ["SKU"],
  name: ["Product", "Name", "Product name"],
  category: ["Category"],
  packaging: ["Packaging", "Raw packaging"],
  warehouseQuantity: ["Warehouse", "Base quantity", "Warehouse quantity"],
  price: ["Selling price", "Price amount", "Price"],
  minStock: ["Min stock", "Minimum stock"],
  active: ["Status", "Active"],
  currency: ["Currency"],
  priceUnit: ["Price unit"],
  baseUnit: ["Base unit", "Base unit code"],
  levels: ["Packaging levels", "Packaging levels JSON"],
  packagingVersion: ["Packaging version", "Configuration version"],
};
export function inferColumnMapping(headers: string[]): ColumnMapping {
  const result: ColumnMapping = {};
  for (const [field, names] of Object.entries(aliases)) {
    const header = headers.find((h) =>
      names.some((n) => normalize(n) === normalize(h)),
    );
    if (header) result[field as ImportField] = header;
  }
  return result;
}
function integer(value: string) {
  return /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : null;
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function previewProductImport(
  csv: string,
  products: Product[] = [],
  requestedMapping?: ColumnMapping,
): ProductImportPreview {
  const records = parseCsv(csv);
  if (!records.length) throw new DocumentError("CSV is empty.", "CSV_EMPTY");
  const headers = records[0].cells;
  if (
    headers.some((h) => !h.trim()) ||
    new Set(headers.map(normalize)).size !== headers.length
  )
    throw new DocumentError(
      "CSV headers must be nonempty and unique.",
      "CSV_HEADERS",
    );
  const mapping =
    requestedMapping === undefined
      ? inferColumnMapping(headers)
      : requestedMapping;
  const mappedHeaders = Object.values(mapping).filter(Boolean);
  if (mappedHeaders.some((h) => !headers.includes(h)))
    throw new DocumentError(
      "Column mapping refers to an unknown header.",
      "CSV_MAPPING",
    );
  if (new Set(mappedHeaders).size !== mappedHeaders.length)
    throw new DocumentError(
      "Each source column can map to only one field.",
      "CSV_MAPPING",
    );
  const errors: string[] = [];
  if (!mapping.name) errors.push("Map a Product/name column before importing.");
  if (records.length < 2) errors.push("CSV has no product rows.");
  const byId = new Map(products.map((p) => [p.id, p]));
  const bySku = new Map<string, Product[]>(),
    byName = new Map<string, Product[]>();
  for (const p of products) {
    if (p.sku) {
      const k = normalize(p.sku);
      bySku.set(k, [...(bySku.get(k) || []), p]);
    }
    const k = `${normalize(p.name)}|${normalize(p.category)}`;
    byName.set(k, [...(byName.get(k) || []), p]);
  }
  const seen = new Map<string, number>();
  const rows = records.slice(1).map((record) => {
    const raw: Record<string, string> = Object.fromEntries(
      headers.map((h, i) => [h, record.cells[i] ?? ""]),
    );
    const get = (field: ImportField) =>
      mapping[field] ? (raw[mapping[field]!] ?? "") : "";
    const issues: ImportIssue[] = [];
    const issue = (
      code: string,
      message: string,
      severity: "error" | "warning" = "warning",
    ) => issues.push({ code, message, severity });
    if (record.cells.length !== headers.length)
      issue(
        "COLUMN_COUNT",
        `Row has ${record.cells.length} cells; expected ${headers.length}.`,
        "error",
      );
    const name = get("name").trim(),
      category = get("category").trim(),
      id = get("id").trim(),
      sku = get("sku").trim();
    if (!name) issue("NAME_REQUIRED", "Product name is required.", "error");
    if (name.length > 160 || category.length > 100 || sku.length > 80)
      issue(
        "VALUE_LENGTH",
        "Name, category or SKU exceeds its maximum length.",
        "error",
      );
    const status = get("active").trim().toLowerCase();
    if (status && !["true", "false", "1", "0"].includes(status))
      issue("INVALID_BOOLEAN", "Status must be true, false, 1 or 0.", "error");
    if (!status)
      issue(
        "ACTIVE_DEFAULT",
        "Status is missing; the draft product defaults to inactive.",
      );
    const minStock = get("minStock").trim() ? integer(get("minStock")) : 0;
    if (minStock === null)
      issue(
        "INVALID_MIN_STOCK",
        "Minimum stock must be a nonnegative integer.",
        "error",
      );
    if (mapping.minStock)
      issue(
        "MIN_STOCK_POLICY",
        "Confirm minimum-stock base unit and per-location threshold policy.",
      );
    const stockRaw = get("warehouseQuantity").trim(),
      sourceStockQuantity = stockRaw ? integer(stockRaw) : null;
    if (stockRaw && sourceStockQuantity === null)
      issue(
        "INVALID_STOCK",
        "Exported Warehouse value must be a nonnegative integer quantity.",
        "error",
      );
    if (mapping.warehouseQuantity)
      issue(
        "NO_STOCK_IMPORT",
        "Warehouse is an exported quantity, not a warehouse ID. Catalogue import never writes inventory; use a separate reviewed opening receipt.",
      );
    const priceRaw = get("price").trim();
    const validPrice = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(priceRaw);
    if (priceRaw && !validPrice)
      issue(
        "INVALID_PRICE",
        "Price must be a nonnegative decimal amount with at most two decimals.",
        "error",
      );
    const currency = get("currency").trim().toUpperCase() || "INR",
      priceUnit = get("priceUnit").trim() || null;
    if (!/^[A-Z]{3}$/.test(currency))
      issue(
        "INVALID_CURRENCY",
        "Currency must be an ISO-style three-letter code.",
        "error",
      );
    if (priceRaw && (!priceUnit || !get("currency")))
      issue(
        "PRICE_CONFIRMATION",
        "Selling price is preserved. Confirm currency and price-unit before using it in sales calculations.",
      );
    let packaging: ProductImportRow["packaging"] = null;
    if (get("baseUnit") && get("levels")) {
      try {
        const levels: unknown = JSON.parse(get("levels"));
        if (
          !Array.isArray(levels) ||
          !levels.length ||
          levels.length > 8 ||
          levels.some(
            (l) =>
              typeof l !== "object" ||
              !l ||
              typeof l.code !== "string" ||
              typeof l.label !== "string" ||
              !Number.isSafeInteger(l.factor) ||
              l.factor < 1,
          )
        )
          throw new Error();
        const typed = levels as UnitLevel[];
        if (
          new Set(typed.map((l) => normalize(l.code))).size !== typed.length ||
          typed.filter((l) => l.factor === 1).length !== 1
        )
          throw new Error();
        const ascending = [...typed].sort((a, b) => a.factor - b.factor);
        if (
          ascending.some(
            (l, i) =>
              i > 0 &&
              (l.factor <= ascending[i - 1].factor ||
                l.factor % ascending[i - 1].factor !== 0),
          )
        )
          throw new Error();
        packaging = {
          baseUnit: get("baseUnit"),
          levels: typed,
          sourceVersion: get("packagingVersion"),
        };
        issue(
          "PACKAGING_CONFIRMATION",
          "Imported packaging definitions require confirmation; historical version IDs are not reused.",
        );
      } catch {
        issue(
          "INVALID_PACKAGING",
          "Packaging levels must be valid JSON with unique codes, one factor-1 base and exact nested positive integer factors.",
          "error",
        );
      }
    } else
      issue(
        "PACKAGING_REQUIRED",
        `Packaging setup required${get("packaging") ? `; raw value "${get("packaging")}" does not define conversion ratios` : ""}.`,
      );
    const candidates: ProductImportRow["candidates"] = [];
    if (id) {
      const p = byId.get(id);
      if (p)
        candidates.push({
          id: p.id,
          name: p.name,
          reason: "Exact product ID.",
        });
      else
        issue(
          "UNKNOWN_ID",
          "Source product ID is not present in this catalogue. Explicitly choose create or skip.",
        );
    }
    if (!candidates.length && sku)
      for (const p of bySku.get(normalize(sku)) || [])
        candidates.push({
          id: p.id,
          name: p.name,
          reason: "Exact normalized SKU.",
        });
    if (!candidates.length)
      for (const p of byName.get(`${normalize(name)}|${normalize(category)}`) ||
        [])
        candidates.push({
          id: p.id,
          name: p.name,
          reason: "Name and category match; select update or skip explicitly.",
        });
    if (candidates.length)
      issue(
        "DUPLICATE_CANDIDATE",
        "An existing product may match this row; explicitly choose update or skip.",
      );
    const key = id
      ? `id:${id}`
      : sku
        ? `sku:${normalize(sku)}`
        : `name:${normalize(name)}|${normalize(category)}`;
    if (seen.has(key))
      issue(
        "DUPLICATE_ROW",
        `Matches CSV row ${seen.get(key)}. Choose one row to import; skip the duplicate.`,
        "error",
      );
    else seen.set(key, record.rowNumber);
    const product: ProductImportRow["product"] = {
      ...(id ? { id } : {}),
      ...(sku ? { sku } : {}),
      name,
      category,
      active: ["true", "1"].includes(status),
      minStock: minStock ?? 0,
      price: validPrice ? priceRaw : null,
      currency,
      priceUnit,
      rawImport: { ...raw, _sourceRow: String(record.rowNumber) },
    };
    return {
      rowNumber: record.rowNumber,
      raw,
      fingerprint: hash({ raw, mapping }),
      product,
      sourceStockQuantity,
      packagingRaw: get("packaging"),
      packaging,
      issues,
      candidates,
    };
  });
  return {
    headers,
    mapping,
    rows,
    errors,
    warnings: [
      "Import is catalogue-only. No Warehouse quantity is applied to stock.",
      "Incomplete products can be saved as drafts; packaging must be configured before stock operations.",
    ],
    fileHash: hash(csv),
  };
}

/** CSV exports default to formula-neutralizing text cells. Set safe=false only for internal exact round-trip tests. */
export function stringifyCsv(
  rows: (string | number | boolean | null | undefined)[][],
  safe = true,
) {
  const cell = (value: string | number | boolean | null | undefined) => {
    let s = value === null || value === undefined ? "" : String(value);
    if (safe && typeof value === "string" && /^[\s\t\r]*[=+@-]/.test(s))
      s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return (
    "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n"
  );
}
/** Reparse on confirmation; client previews and proposed product payloads are never trusted. */
export function prepareProductImport(
  csv: string,
  products: Product[],
  mapping: ColumnMapping | undefined,
  decisions: ImportDecision[],
) {
  const preview = previewProductImport(csv, products, mapping);
  if (preview.errors.length)
    throw new DocumentError(preview.errors.join(" "), "CSV_PREVIEW_ERRORS");
  if (!Array.isArray(decisions) || decisions.length !== preview.rows.length)
    throw new DocumentError(
      "Choose create, update or skip for every CSV row.",
      "IMPORT_DECISIONS",
    );
  const byRow = new Map<number, ImportDecision>();
  for (const decision of decisions) {
    if (
      !decision ||
      !Number.isSafeInteger(decision.rowNumber) ||
      !["create", "update", "skip"].includes(decision.action) ||
      byRow.has(decision.rowNumber)
    )
      throw new DocumentError(
        "Import decisions must use unique source row numbers and a valid action.",
        "IMPORT_DECISIONS",
      );
    byRow.set(decision.rowNumber, decision);
  }
  const operations: PreparedProductImport[] = [];
  const targets = new Set<string>();
  let skipped = 0;
  for (const row of preview.rows) {
    const decision = byRow.get(row.rowNumber);
    if (!decision)
      throw new DocumentError(
        `Missing decision for row ${row.rowNumber}.`,
        "IMPORT_DECISIONS",
      );
    if (decision.action === "skip") {
      skipped++;
      continue;
    }
    const errors = row.issues.filter((i) => i.severity === "error");
    if (errors.length)
      throw new DocumentError(
        `Row ${row.rowNumber}: ${errors.map((e) => e.message).join(" ")}`,
        "IMPORT_ROW_ERROR",
      );
    if (decision.action === "create" && row.candidates.length)
      throw new DocumentError(
        `Row ${row.rowNumber} matches an existing product. Choose update or skip.`,
        "IMPORT_DUPLICATE",
      );
    let target: Product | undefined;
    if (decision.action === "update") {
      target = products.find((p) => p.id === decision.productId);
      if (!target)
        throw new DocumentError(
          `Row ${row.rowNumber}: select an existing product for update.`,
          "IMPORT_TARGET",
        );
      if (
        row.candidates.length &&
        !row.candidates.some((p) => p.id === target!.id)
      )
        throw new DocumentError(
          `Row ${row.rowNumber}: update target must be a displayed matching candidate.`,
          "IMPORT_TARGET",
        );
      if (targets.has(target.id))
        throw new DocumentError(
          "Two CSV rows cannot update the same product in one import.",
          "IMPORT_DUPLICATE",
        );
      targets.add(target.id);
    }
    if (row.product.minStock > 0 && decision.confirmMinimumStock !== true)
      throw new DocumentError(
        `Row ${row.rowNumber}: confirm the base-unit and location threshold policy for minimum stock.`,
        "IMPORT_MIN_STOCK_CONFIRMATION",
      );
    let currency = row.product.currency,
      priceUnit: string | null = null;
    if (decision.confirmPrice === true) {
      currency =
        typeof decision.currency === "string"
          ? decision.currency.trim().toUpperCase()
          : "";
      priceUnit =
        typeof decision.priceUnit === "string" ? decision.priceUnit.trim() : "";
      if (!/^[A-Z]{3}$/.test(currency) || !priceUnit || priceUnit.length > 40)
        throw new DocumentError(
          `Row ${row.rowNumber}: confirm a three-letter currency and explicit price unit.`,
          "IMPORT_PRICE_CONFIRMATION",
        );
      if (
        target?.packaging &&
        !target.packaging.levels.some((l) => l.code === priceUnit)
      )
        throw new DocumentError(
          `Row ${row.rowNumber}: price unit must exist in the target product packaging.`,
          "IMPORT_PRICE_CONFIRMATION",
        );
    }
    const product = { ...row.product };
    delete product.id;
    const used = new Set(Object.values(preview.mapping));
    const unused = Object.fromEntries(
      Object.entries(row.raw).filter(([key]) => !used.has(key)),
    );
    operations.push({
      ...product,
      currency,
      priceUnit,
      ...(target ? { id: target.id } : {}),
      rawImport: {
        ...row.raw,
        _sourceRow: String(row.rowNumber),
        _importFingerprint: row.fingerprint,
        _columnMapping: JSON.stringify(preview.mapping),
        _unusedColumns: JSON.stringify(unused),
        _sourceStockQuantity:
          row.sourceStockQuantity === null
            ? ""
            : String(row.sourceStockQuantity),
        _stockApplied: "false",
        _priceBasisConfirmed: String(decision.confirmPrice === true),
        _minimumStockPolicyConfirmed: String(
          decision.confirmMinimumStock === true,
        ),
        _packagingApplied: "false",
      },
    });
  }
  return {
    preview,
    products: operations,
    summary: {
      created: operations.filter((o) => !o.id).length,
      updated: operations.filter((o) => Boolean(o.id)).length,
      skipped,
      stockMovements: 0,
    },
  };
}
export const parseCSV = parseCsv;
export const stringifyCSV = stringifyCsv;
