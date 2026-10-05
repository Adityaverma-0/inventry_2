import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseCsv,
  stringifyCsv,
  previewProductImport,
  prepareProductImport,
} from "../lib/documents/csv.ts";
import { parseInvoiceText } from "../lib/documents/parse-invoice.ts";
import { createProductMatcher } from "../lib/documents/matching.ts";
import {
  storeUpload,
  readStoredFile,
  validateUpload,
} from "../lib/documents/storage.ts";
import { extractInvoice } from "../lib/documents/extract.ts";
import {
  queueExtraction,
  resumeExtractionQueue,
} from "../lib/documents/queue.ts";
import type { Product } from "../lib/domain/types.ts";

const fixture = (name: string) =>
  new URL(`./fixtures/${name}`, import.meta.url);
async function isolatedFiles(work: () => Promise<void>) {
  const previous = process.env.DATA_DIR,
    dir = await mkdtemp(path.join(tmpdir(), "sanket-runtime-test-"));
  process.env.DATA_DIR = dir;
  try {
    await work();
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}
const source =
  '"Product","Category","Packaging","Warehouse","Selling price","Min stock","Status"\r\n"Allu Bhumiya","snaks","1","0","200.00","0","true"\r\n';
const product: Product = {
  id: "f5ed1d02-4d92-4276-8ee0-f9fc6ca086de",
  sku: "",
  name: "Allu Bhumiya",
  category: "snaks",
  active: true,
  ready: true,
  minStock: 0,
  price: null,
  priceUnit: null,
  currency: "INR",
  createdAt: "",
  packaging: {
    id: "51d3cfac-9930-47ec-b971-ac74fa150479",
    version: 1,
    baseUnit: "piece",
    levels: [
      { code: "piece", label: "Piece", factor: 1 },
      { code: "strip", label: "Strip", factor: 12 },
      { code: "box", label: "Box", factor: 144 },
    ],
    createdAt: "",
    reason: "test",
  },
};
test("RFC CSV preserves BOM, quoted commas, escaped quotes, newlines, empties and physical source rows", () => {
  const records = parseCsv(
    '\uFEFF"Product","Notes","Blank"\r\n"A, B","Say ""hi""\nnext",""\r\n"C","",""',
  );
  assert.deepEqual(
    records.map((r) => r.cells),
    [
      ["Product", "Notes", "Blank"],
      ["A, B", 'Say "hi"\nnext', ""],
      ["C", "", ""],
    ],
  );
  assert.equal(records[2].rowNumber, 4);
  assert.deepEqual(
    parseCsv(
      stringifyCsv(
        records.map((r) => r.cells),
        false,
      ),
    ).map((r) => r.cells),
    records.map((r) => r.cells),
  );
  assert.throws(() => parseCsv('a,b\n"unclosed'), /Unclosed/);
  assert.throws(() => parseCsv('a\n"a"bad'), /Unexpected/);
  assert.match(stringifyCsv([['=HYPERLINK("bad")']]), /"'=HYPERLINK/);
});
test("exact supplied export remains a draft catalogue import with no fabricated units or stock", () => {
  const p = previewProductImport(source);
  const row = p.rows[0];
  assert.equal(row.product.name, "Allu Bhumiya");
  assert.equal(row.product.category, "snaks");
  assert.equal(row.packagingRaw, "1");
  assert.equal(row.packaging, null);
  assert.equal(row.sourceStockQuantity, 0);
  assert.equal(row.product.minStock, 0);
  assert.equal(row.product.price, "200.00");
  assert.equal(row.product.priceUnit, null);
  assert.equal(row.product.active, true);
  const prepared = prepareProductImport(source, [], undefined, [
    { rowNumber: 2, action: "create" },
  ]);
  assert.deepEqual(prepared.summary, {
    created: 1,
    updated: 0,
    skipped: 0,
    stockMovements: 0,
  });
  assert.equal(prepared.products[0].rawImport._stockApplied, "false");
  assert.equal(prepared.products[0].rawImport.Packaging, "1");
  assert.equal("sourceStockQuantity" in prepared.products[0], false);
  assert.equal("id" in prepared.products[0], false);
});
test("duplicates, malformed rows, booleans and confirmation choices fail closed", () => {
  assert.throws(
    () =>
      prepareProductImport(source, [product], undefined, [
        { rowNumber: 2, action: "create" },
      ]),
    /existing product/,
  );
  assert.equal(
    prepareProductImport(source, [product], undefined, [
      { rowNumber: 2, action: "update", productId: product.id },
    ]).products[0].id,
    product.id,
  );
  assert.equal(
    prepareProductImport(source, [product], undefined, [
      { rowNumber: 2, action: "skip" },
    ]).products.length,
    0,
  );
  const bad = source.replace('"true"', '"yes"');
  assert.throws(
    () =>
      prepareProductImport(bad, [], undefined, [
        { rowNumber: 2, action: "create" },
      ]),
    /Status must/,
  );
  assert.throws(() => previewProductImport("Name,Name\na,b"), /unique/);
  assert.throws(
    () => prepareProductImport(source, [], undefined, []),
    /every CSV row/,
  );
  assert.throws(
    () =>
      prepareProductImport(source, [], undefined, [
        { rowNumber: 2, action: "create", confirmPrice: true },
      ]),
    /currency and explicit price unit/,
  );
  const duplicated = source + source.split("\r\n")[1] + "\r\n";
  assert.ok(
    previewProductImport(duplicated).rows[1].issues.some(
      (i) => i.code === "DUPLICATE_ROW",
    ),
  );
});
test("column mapping, unrecognized source fields and complete packaging export survive preview", () => {
  const csv = stringifyCsv(
    [
      [
        "Item title",
        "Category",
        "Base unit",
        "Packaging levels JSON",
        "Configuration version",
        "Unknown field",
      ],
      [
        "Example",
        "snaks",
        "piece",
        JSON.stringify(product.packaging!.levels),
        "3",
        "kept",
      ],
    ],
    false,
  );
  const mapping = {
    name: "Item title",
    category: "Category",
    baseUnit: "Base unit",
    levels: "Packaging levels JSON",
    packagingVersion: "Configuration version",
  };
  const row = previewProductImport(csv, [], mapping).rows[0];
  assert.equal(row.packaging!.levels[2].factor, 144);
  assert.equal(row.packaging!.sourceVersion, "3");
  const saved = prepareProductImport(csv, [], mapping, [
    { rowNumber: 2, action: "create" },
  ]).products[0];
  assert.equal(saved.rawImport["Unknown field"], "kept");
  assert.equal(saved.rawImport._packagingApplied, "false");
});
test("invoice parser records evidence, quantities and matching without guessing ambiguous dates or totals", () => {
  const text =
    "Supplier: Example Foods\nInvoice No: A-100\nInvoice Date: 04/10/2026\nDescription  Qty  Unit  Free  Rate  Amount\nAllu Bhumiya  10  Box  2  200  2000\nGrand Total  2000\n";
  const result = parseInvoiceText([text], [product]);
  assert.equal(result.invoiceDate, "");
  assert.equal(result.invoiceNumber, "A-100");
  assert.equal(result.supplier, "Example Foods");
  assert.equal(result.suggestions.length, 1);
  const row = result.suggestions[0];
  assert.equal(row.billedQuantity, 10);
  assert.equal(row.freeQuantity, 2);
  assert.equal(row.matches[0].unitCode, "box");
  assert.equal(row.requiresConfirmation, true);
  assert.equal(row.evidence.page, 1);
  assert.equal(
    parseInvoiceText(["Invoice Date: 2026-02-30"], []).invoiceDate,
    "",
  );
  assert.equal(
    parseInvoiceText(["Invoice Date: 4 October 2026"], []).invoiceDate,
    "2026-10-04",
  );
  assert.equal(
    parseInvoiceText(["Allu Bhumiya  200.00\nTotal: 200.00"], [product])
      .suggestions.length,
    0,
  );
});
test("product matching marks near ties and conflicting numeric variants for review", () => {
  const p2 = { ...product, id: "other", name: "Allu Bhumiya" };
  const m = createProductMatcher([product, p2])("Allu Bhumiya", "Box");
  assert.equal(m[0].confidence, "low");
  assert.equal(
    createProductMatcher([{ ...product, name: "Chips 50" }])("Chips 100")[0]
      .confidence,
    "low",
  );
});
test("private storage validates signatures, size, paths and hash integrity", async () => {
  const previous = process.env.DATA_DIR;
  const dir = await mkdtemp(path.join(tmpdir(), "sanket-storage-test-"));
  process.env.DATA_DIR = dir;
  try {
    const bytes = await readFile(fixture("digital-invoice.pdf"));
    const stored = await storeUpload(
      bytes,
      "../../evil.pdf",
      "application/pdf",
    );
    assert.equal(stored.fileName.includes("/"), false);
    assert.match(stored.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual((await readStoredFile(stored.id)).bytes, bytes);
    await assert.rejects(readStoredFile("../escape"), /not found/);
    assert.throws(() => validateUpload(bytes, "image/png"), /signature/);
    assert.throws(
      () => validateUpload(Buffer.from("<svg>bad</svg>"), "image/png"),
      /Only PDF/,
    );
    assert.throws(
      () => validateUpload(Buffer.alloc(16 * 1024 * 1024), "application/pdf"),
      /15 MB/,
    );
    await writeFile(
      path.join(dir, "uploads", `${stored.id}.bin`),
      Buffer.from("%PDF-modified"),
    );
    await assert.rejects(readStoredFile(stored.id), /integrity/);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
const runtime = process.env.DOCUMENT_RUNTIME_TESTS === "1";
test(
  "actual digital PDF, PNG OCR and scanned PDF OCR produce reviewable invoice evidence",
  { skip: !runtime, timeout: 180_000 },
  async () => {
    await isolatedFiles(async () => {
      for (const [name, mime, engine] of [
        ["digital-invoice.pdf", "application/pdf", "poppler-text"],
        ["invoice-scan.png", "image/png", "tesseract-local-eng"],
        ["scanned-invoice.pdf", "application/pdf", "tesseract-local-eng"],
      ] as const) {
        const bytes = await readFile(fixture(name));
        const metadata = await storeUpload(bytes, name, mime);
        const result = await extractInvoice({ metadata, bytes }, [product]);
        assert.ok(
          result.engines.includes(engine),
          `${name}: correct real engine`,
        );
        assert.match(result.extractedText, /Example Foods/i);
        assert.match(result.extractedText, /Allu Bhumiya/i);
        assert.match(result.invoiceNumber, /^TEST-.?2026-001$/);
        assert.equal(result.invoiceDate, "2026-10-04");
        if (result.invoiceNumber !== "TEST-2026-001")
          assert.ok(
            result.warnings.some((w) => w.includes("unusual OCR characters")),
          );
        assert.ok(
          result.suggestions.some(
            (s) =>
              s.description.includes("Allu Bhumiya") && s.billedQuantity === 10,
          ),
          `${name}: recognized quantity column`,
        );
      }
    });
  },
);
test(
  "asynchronous queue records lifecycle and never receives a stock posting callback",
  { skip: !runtime, timeout: 30_000 },
  async () => {
    await isolatedFiles(async () => {
      const metadata = await storeUpload(
        await readFile(fixture("digital-invoice.pdf")),
        "test.pdf",
        "application/pdf",
      );
      const statuses: string[] = [];
      const hooks = {
        products: async () => [product],
        update: async (_id: string, result: { extractionStatus: string }) => {
          statuses.push(result.extractionStatus);
        },
      };
      const [first, second] = await Promise.all([
        queueExtraction(
          "56de8060-d7ee-4b25-ab78-a0075c24a8cc",
          metadata.id,
          hooks,
        ),
        queueExtraction(
          "56de8060-d7ee-4b25-ab78-a0075c24a8cc",
          metadata.id,
          hooks,
        ),
      ]);
      assert.equal(first.jobId, second.jobId);
      await resumeExtractionQueue(hooks);
      assert.deepEqual(statuses, ["QUEUED", "PROCESSING", "COMPLETED"]);
    });
  },
);
