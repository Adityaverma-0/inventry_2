import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import {
  storeUpload,
  readStoredFile,
  imageDimensions,
} from "../lib/documents/storage.ts";
import {
  invoicePreviewInfo,
  renderInvoicePage,
} from "../lib/documents/preview.ts";

async function isolated(run: () => Promise<void>) {
  const previous = process.env.DATA_DIR,
    dir = await mkdtemp(path.join(tmpdir(), "sanket-preview-test-"));
  process.env.DATA_DIR = dir;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}
async function pdf(pages: number) {
  const doc = new PDFDocument({ size: "A4" }),
    chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (d) => chunks.push(Buffer.from(d)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  for (let n = 1; n <= pages; n++) {
    if (n > 1) doc.addPage();
    doc.fontSize(28).text(`Invoice preview page ${n}`, 50, 80);
    doc
      .fontSize(16)
      .text(
        `Supplier: Example Foods\nInvoice No: PAGE-${n}\nAllu Bhumiya: ${n} Box`,
        50,
        140,
      );
  }
  doc.end();
  return done;
}
test(
  "actual PDF preview renders each page, caches by original hash and rejects invalid bounds",
  { skip: process.env.DOCUMENT_RUNTIME_TESTS !== "1", timeout: 60_000 },
  async () =>
    isolated(async () => {
      const meta = await storeUpload(
          await pdf(2),
          "two-pages.pdf",
          "application/pdf",
        ),
        file = await readStoredFile(meta.id);
      assert.deepEqual(await invoicePreviewInfo(file), {
        pages: 2,
        mime: "application/pdf",
        fileName: "two-pages.pdf",
      });
      const [first, same] = await Promise.all([
        renderInvoicePage(file, 1),
        renderInvoicePage(file, 1),
      ]);
      assert.equal(first.mime, "image/png");
      assert.equal(first.pages, 2);
      assert.deepEqual(first.bytes, same.bytes);
      const second = await renderInvoicePage(file, 2);
      assert.notDeepEqual(first.bytes, second.bytes);
      assert.equal(second.page, 2);
      const dimensions = imageDimensions(first.bytes, "image/png")!;
      assert.ok(dimensions.width <= 2000 && dimensions.height <= 2000);
      await assert.rejects(
        renderInvoicePage(file, 0),
        (e) => (e as { code: string }).code === "INVALID_PAGE",
      );
      await assert.rejects(
        renderInvoicePage(file, 3),
        (e) => (e as { code: string }).code === "PAGE_NOT_FOUND",
      );
      await assert.rejects(
        renderInvoicePage(
          {
            ...file,
            bytes: Buffer.concat([file.bytes, Buffer.from("tampered")]),
          },
          1,
        ),
        (e) => (e as { code: string }).code === "FILE_INTEGRITY",
      );
      const tooMany = await storeUpload(
        await pdf(21),
        "too-many-pages.pdf",
        "application/pdf",
      );
      await assert.rejects(
        invoicePreviewInfo(await readStoredFile(tooMany.id)),
        (e) => (e as { code: string }).code === "PAGE_LIMIT",
      );
      const output = path.resolve(
        process.env.TEST_OUTPUT_DIR || "work",
        "invoice-preview-verification",
      );
      await mkdir(output, { recursive: true });
      await writeFile(path.join(output, "page-1.png"), first.bytes);
      await writeFile(path.join(output, "page-2.png"), second.bytes);
    }),
);
test("image invoice preview preserves source bytes and is single-page", async () =>
  isolated(async () => {
    const bytes = await readFile(
      new URL("./fixtures/invoice-scan.png", import.meta.url),
    );
    const meta = await storeUpload(bytes, "invoice.png", "image/png"),
      file = await readStoredFile(meta.id);
    assert.equal((await invoicePreviewInfo(file)).pages, 1);
    assert.deepEqual((await renderInvoicePage(file)).bytes, bytes);
    await assert.rejects(
      renderInvoicePage(file, 2),
      (e) => (e as { code: string }).code === "PAGE_NOT_FOUND",
    );
  }));
