# Verification record

Checked on 4 October 2026. Tests use synthetic fixtures and a separate `sanket_test` PostgreSQL database. The main first-owner setup database was not seeded by these tests. HTTP checks passed against both development and production servers. Desktop browser workflow checks are recorded below.

## Latest fixes and database preparation

- Packaging activation accepts an explicit selling price/unit in the new hierarchy and updates both atomically; invalid changes do not alter stock or pricing.
- Load, sale and receipt previews reject invalid, excessive or overflowing quantities before formatting; duplicate product lines are checked together.
- First-owner setup no longer seeds locations, godowns or vehicles. Synthetic business setup exists only in test fixtures.
- Domain regression suite: 19 passed. Stock-preview regression suite: 2 passed. Fresh-database HTTP workflow suite: 10 passed, including empty setup. ESLint, TypeScript and production build passed.
- Neon connectivity was verified. The application remains on its local database pending the user's empty-database versus business-record migration choice. A private local database backup exists outside this source package. No remote data transfer or deletion has been performed.

## Warehouse enhancements

See [warehouse enhancement verification](docs/WAREHOUSE-ENHANCEMENTS.md) for the new 23-test domain run, 11 HTTP checks, browser evidence and the native-print verification limitation. Migration 103 preserved existing business-table counts.

## Document and import utilities: 9 passed

Command:

```sh
DOCUMENT_RUNTIME_TESTS=1 node --env-file=.env.local --experimental-strip-types --test tests/documents.test.mts
```

Actual Poppler and Tesseract were exercised; extraction responses are not mocked. Coverage:

1. RFC-style CSV parsing: BOM, quoted commas, escaped quotes, multiline and empty cells, physical row numbers, exact internal round trip, malformed quotes, formula-safe export.
2. Exact provided source row: `Allu Bhumiya`, `snaks`, packaging `1`, stock `0`, price `200.00`, minimum `0`, active `true`. No invented packaging, warehouse ID, stock movement or price basis.
3. Existing-product duplicates, invalid booleans, missing decisions, repeated source rows, and explicit price confirmation.
4. Column mapping, complete packaging definition preview, source configuration version, and preservation of unused raw fields.
5. Invoice evidence, billed/free quantities, missing/ambiguous dates, invalid dates, and the separation of money from stock quantities.
6. Product-match ties and conflicting numeric variants flagged for review.
7. Private UUID storage, signature/MIME/size rejection, path traversal refusal and tampered-file hash checks.
8. Digital PDF extraction, PNG OCR and scanned PDF OCR with real engines. The OCR fixture produces an occasional extra dash or `Q` for zero; those raw ambiguities are preserved and flagged, not silently corrected.
9. Asynchronous queued/processing/completed lifecycle, concurrent enqueue deduplication, and no stock-posting callback. Runtime test storage is isolated in temporary directories.

Without `DOCUMENT_RUNTIME_TESTS=1`, the seven pure/storage tests run and the two runtime tests are explicitly skipped. Poppler is required for the runtime tests; the pinned English OCR model is included in `runtime/ocr`.

## HTTP workflow: 10 passed

Start the isolated test server with `node scripts/test-server.mjs`, then run:

```sh
node --experimental-strip-types --test tests/v2-http.test.mjs
```

This reports nine subtests and one enclosing test (10 total). The final production-server run passed all 10 in 2.7 seconds. The suite refuses hosts/ports other than the local test server on 5174. It creates reusable test credentials outside the deliverable in `work/test-credentials.json`, mode 0600, without printing passwords. The repeated-setup assertion checks development's local-setup lockout (409) and production's required setup-token boundary (403) separately.

- Unauthenticated state/file/import rejection and cross-origin write rejection.
- First-owner setup, setup lockout, login failure, HttpOnly/SameSite session cookie, and no credential fields in state.
- CSV preview, explicit catalogue import, exact request replay, changed-payload conflict, all-skip summary, no stock changes, preserved raw values and incomplete-product readiness.
- Digital invoice upload, same-request retry, renamed same-hash rejection, idempotency conflict, persisted extraction suggestions, original byte-for-byte private download, unauthenticated file denial, and authenticated source-preview headers (`SAMEORIGIN` plus `frame-ancestors 'self'`).
- Scanned PDF OCR, re-extraction without stock changes, and invalid PDF signature rejection.
- Salesman rejection for owner files, extraction, import, purchase approval, catalogue export and product changes; private owner state is absent.
- CSV export fields, invalid export types, CSRF, logout revocation and re-login.
- Approved report snapshot at **329 pieces = 2 boxes + 3 strips + 5 pieces** with 144/12/1 factors. After ratios change to 100/10/1, the exact historical revision and its CSV still show those old counts; live stock CSV shows **3 boxes + 2 strips + 9 pieces**, with the same 329 base pieces. Packing definitions and separate unit-count columns are checked. Invalid calendar dates and report revisions are rejected.
- Invoice revision history, ready/approve decisions and a linked damaged-piece correction with source document ID; salesman history denial and re-extraction refusal after posting. Godown reconciliation CSV verifies **0 opening + 360 receipts − 350 outgoing − 1 adjustment = 9 closing**, with matching ledger/live-balance flags and salesman rejection.

## Exact-revision PDF: passed

```sh
DOCUMENT_RUNTIME_TESTS=1 node --env-file=.env.local --experimental-strip-types --test tests/report-pdf.test.mts
```

The dedicated PDF test passed with real PDFKit generation and Poppler inspection. A 30-product, nine-page fixture retains the final row, saved 144/12/1 factors, approval status, correction annotation and page numbering. Rendered table, packaging and annotation pages were visually inspected. Final source-rendered first and last pages are clean after correcting footer-induced blank pages, a clipped table heading and a separated annotation heading. Open-licensed DejaVu fonts and their license/checksums are included under `runtime/fonts`.

The production HTTP suite also downloads an authorized exact-revision PDF, verifies its PDF signature, MIME type, attachment response and unauthenticated/invalid-revision rejection. Its generated report is one A4-landscape page. Poppler text extraction confirms **329 = 2 boxes + 3 strips + 5 pieces** and **1 box = 144 pieces**, even after the current product factors change.

After the final release rebuild, the same approved revision was fetched again without changing any business fixtures. Its one-page production PDF was rendered and visually inspected: the Adjustments heading is fully visible, all table cells and saved ratios are readable, and page numbering is correct. Poppler reconfirmed the saved 144/12/1 factors and 329-piece closing breakdown. Both the source-generated multi-page fixture and the final production response passed PDF verification.

## Repairs verified during integration

Authenticated invoice raster preview was added after the in-app browser's native PDF viewer displayed a black page. `GET /api/v2/files/:id/preview?metadata=true` returns the page count; `?page=N` returns a locally rendered PNG. The original download remains available. The renderer checks source hashes, limits PDFs to 20 pages, bounds each rendered edge to 2,000 pixels, uses 30-second parser timeouts and private hash-keyed cache files, and allows only two concurrent parser jobs.

Two preview utility tests passed with actual Poppler: distinct two-page rendering, repeated-page caching, invalid/out-of-range pages, 21-page rejection, changed-source hash rejection and single-page image passthrough. One targeted HTTP test passed on a temporary isolated server using existing test accounts and copied source files: owner PNG rendering, page metadata/headers, private/no-store, missing-file rejection, invalid page rejection, and unauthenticated/salesman denial. Both synthetic pages and the HTTP-rendered invoice page were visually inspected and readable. No business fixtures were changed. The temporary server was stopped. After rebuilding the release, the private preview HTTP check passed again and the invoice page rendered successfully in the review dialog. Screenshot evidence: `../sanket-invoice-preview.jpg`.

```sh
DOCUMENT_RUNTIME_TESTS=1 node --env-file=.env.local --experimental-strip-types --test tests/invoice-preview.test.mts
PREVIEW_TEST_URL=http://127.0.0.1:5174 node --test tests/invoice-preview-http.test.mjs
```

- An imported-product retry previously recomputed the plan against the changed catalogue and failed as a duplicate. The HTTP route now persists the validated plan before applying the idempotent catalogue transaction, checks the exact source/decisions on reuse, and replays the saved plan.
- Startup queue recovery no longer makes an upload request wait for the entire OCR drain. Posted/deleted documents terminate obsolete extraction jobs instead of repeatedly retrying them.
- Stock CSV now includes numeric unit components and packing factors. Historical report CSV includes its saved factors and exact selected revision.
- Global frame-denial headers previously blocked the authenticated invoice preview. Only the private invoice-file route now allows same-origin framing; the rest of the application retains frame denial. The HTTP suite verifies the resulting headers.

## Scope of this evidence

These checks establish the tested API and synthetic-document behaviors. OCR accuracy on arbitrary supplier layouts still depends on document quality; unsupported tables retain source text and require manual review. The durable file queue supports one persistent Node process and persistent private storage; a serverless or multi-worker deployment requires a different queue adapter. No third-party OCR credentials are required and invoice content stays local.

## Browser workflow checks

Executed on 4 October 2026 against the isolated production server at port 5174 using synthetic records. The clean business workspace at port 5173 remains on first-owner setup.

- Owner sign-in, navigation and invoice upload dialog opened successfully.
- Reviewed a digital invoice, explicitly applied extracted header suggestions, mapped the product/version/unit, and entered 10 physically received pieces. Saving created revision 2; marking ready and confirming approval produced a posted receipt in Dewas, normalized as 1 Strip. Posted fields became read-only.
- Opened an approved report showing saved 144/12/1 packaging and 329 pieces = 2 Boxes + 3 Strips + 5 Pieces. Reopened it with a required reason.
- Signed in as the assigned salesman. Reviewed and posted one Strip under active 100/10/1 packaging. The projected and generated closing balance both became 319 pieces = 3 Boxes + 1 Strip + 9 Pieces.
- Generated and submitted revision 2, then signed in as admin and approved that revision. The saved report shows its submission time, owner decision time/name/note, 319-piece closing balance and both revision choices. Screenshot evidence: `../sanket-approved-report-preview.jpg`.
- The main workspace's first-owner setup screen was visually inspected and captured in `../sanket-website-preview.jpg`.

These interactions used keyboard activation and form controls. Desktop testing used a 1366-pixel layout viewport. A later narrow-layout visual check reached 390 × 844 CSS pixels and showed responsive cards and bottom navigation, but the full mobile/touch journey is **not claimed**. Real-device GPS permission/staleness, offline reconnect with unresolved drafts, installed-PWA behavior and Docker/hosted deployment remain outside the executed browser checks. The corresponding server/domain protections are tested separately above.


## Final release check

The final source passed `npm run lint`, `npm run typecheck` and `NEXT_DIST_DIR=.next-release npm run build`. The rebuilt production server passed all 10 HTTP checks and the private preview HTTP check. The complete PostgreSQL regression suite passed **18/18 groups**, including normalized duplicate-delivery checks in both receipt sequences, search before pagination, and immutable business/godown/location report identity after master records are renamed. The three PDF/preview runtime tests also passed.

New report revisions snapshot business name, godown, location and timezone. PDF, CSV and the report screen use these saved labels. Older revisions that predate these fields explicitly say they were not captured; current master names are not substituted. The updated nine-page PDF's first page was rendered and visually checked after adding the saved header fields: no overlapping labels, clipped headings or table content.

Migration 102 was applied successfully to both the clean business database and isolated HTTP test database. Source test paths now default to an ignored local `work/` directory and support explicit path overrides.
