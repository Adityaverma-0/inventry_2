import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { renderReportPdf } from "../lib/documents/report-pdf.ts";
import type { DailyReport } from "../lib/domain/types.ts";

const execute = promisify(execFile);
test("multi-page saved report PDF retains old ratios, full rows, notes, decisions and correction annotations", async () => {
  const report: DailyReport = {
    id: "7c8ac24d-ee4c-4c75-96a2-fe73c5b06ba8",
    revisionId: "ca0c63c0-1adc-43f5-bafe-cc00fce462a4",
    businessName: "Saved Sanket Trading",
    warehouseName: "Saved Hardpiplya Godown",
    locationName: "Saved Hardpiplya",
    timezone: "Asia/Kolkata",
    revision: 3,
    day: "2026-10-04",
    vehicleId: "3cb4bede-7d7f-414b-b9ca-630b97db33ad",
    vehicleName: "Hardpiplya Vehicle 1",
    salesmanId: "36bb3dfb-95fa-4dbe-80ca-e44b42e8f16a",
    salesmanName: "Example Salesman",
    status: "APPROVED",
    submittedAt: "2026-10-04T11:45:00Z",
    decidedAt: "2026-10-04T12:15:00Z",
    decidedBy: "Example Owner",
    decisionReason:
      "Counted and verified the saved 12 × 12 package configuration.",
    notes:
      "End-of-day stock count checked against the physical vehicle inventory.",
    sourceHash: "abcdef0123456789".repeat(4),
    lines: Array.from({ length: 30 }, (_, i) => ({
      productId: `product-${i}`,
      productName: `Product ${String(i + 1).padStart(2, "0")} · ${i % 3 === 0 ? "Long product description with original pack size retained for historical review" : "Allu Bhumiya"}`,
      packagingId: `packaging-record-${i}`,
      baseUnit: "piece",
      levels: [
        { code: "box", label: "Box", factor: 144 },
        { code: "strip", label: "Strip", factor: 12 },
        { code: "piece", label: "Piece", factor: 1 },
      ],
      opening: 0,
      loaded: 350,
      sold: 21,
      reversed: 0,
      adjustments: 0,
      closing: 329,
      formatted: "2 Box + 3 Strip + 5 Piece",
    })),
    amendments: [
      {
        reference: "CORR-EXAMPLE-1",
        originalReference: "SALE-EXAMPLE-1",
        day: "2026-10-04",
        reason: "Preserved example correction annotation.",
      },
    ],
  };
  const pdf = await renderReportPdf(report);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 20_000);
  const dir = path.resolve(
    process.env.TEST_OUTPUT_DIR || "work",
    "pdf-verification",
  );
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "report-multipage.pdf");
  await writeFile(file, pdf);
  if (process.env.DOCUMENT_RUNTIME_TESTS === "1") {
    const bin = (name: string) =>
      process.env.POPPLER_BIN ? path.join(process.env.POPPLER_BIN, name) : name;
    const info = (await execute(bin("pdfinfo"), [file], { timeout: 30_000 }))
      .stdout;
    const pages = Number(info.match(/^Pages:\s*(\d+)/m)?.[1]);
    assert.ok(pages >= 3);
    const text = (
      await execute(bin("pdftotext"), ["-layout", file, "-"], {
        timeout: 30_000,
      })
    ).stdout;
    assert.match(text, /Saved Sanket Trading/);
    assert.match(text, /Saved Hardpiplya Godown/);
    assert.match(text, /Saved Hardpiplya/);
    assert.match(text, /Asia\/Kolkata/);
    assert.match(text, /Product 30/);
    assert.match(text, /2 Box \+ 3 Strip \+ 5 Piece/);
    assert.match(text, /1 Box = 144 piece/);
    assert.match(text, /CORR-EXAMPLE-1/);
    assert.match(text, /APPROVED/);
    assert.match(text, new RegExp(`Page ${pages} of ${pages}`));
    await writeFile(path.join(dir, "report-multipage.txt"), text);
    const exact = path.resolve(
      process.env.TEST_OUTPUT_DIR || "work",
      "report-exact-revision.pdf",
    );
    try {
      await readFile(exact);
      const saved = (
        await execute(bin("pdftotext"), ["-layout", exact, "-"], {
          timeout: 30_000,
        })
      ).stdout;
      assert.match(saved, /2 Box \+ 3 Strip \+ 5 Piece/);
      assert.match(saved, /1 Box = 144 piece/);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
});
