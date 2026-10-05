# Private invoice and catalogue utilities

These modules are server-only: import them from Node routes or worker code, never client components. They have no inventory posting capability.

## Runtime

- Node 22.13+ and the pinned `tesseract.js` 7.0.0 package.
- Poppler `pdfinfo`, `pdftotext`, `pdftoppm` on PATH, or set `POPPLER_BIN` to their directory. Install `poppler-utils`, `fontconfig` and basic fonts in Linux containers.
- `DATA_DIR` is private writable persistent storage, outside `public`. Default `.data`. Back it up with PostgreSQL: it contains original uploads and queued jobs.
- English OCR model is included at `runtime/ocr/eng.traineddata`, with source commit, checksum and license in `runtime/ocr/PROVENANCE.md`. Override with local directory `TESSERACT_LANG_PATH`. HTTP model paths are rejected. No API credentials or outbound OCR requests are used.
- Standard Poppler installations find their font configuration automatically. Relocated macOS runtimes may need a local `FONTCONFIG_FILE` with writable cache locations; do not copy local machine paths into a deployment.
- Run one persistent Node server/worker with the shared persistent DATA_DIR. The queue is not designed for ephemeral/serverless or multi-worker deployment. For multiple replicas, replace it with an external durable worker queue before scaling.

## Storage and extraction

```ts
const metadata = await storeUpload(buffer, originalName, statedMime);
// Store metadata against an authenticated owner's invoice in PostgreSQL.
const file = await readStoredFile(metadata.fileId); // caller must authorize access first
const result = await extractInvoice(file, products);
```

`storeUpload` validates file size, PDF/PNG/JPEG signatures, MIME consistency and image dimensions; saves UUID paths with private modes and SHA-256. Downloads recheck size and hash and return metadata/bytes only. Filenames are display metadata. Serve authenticated downloads with private/no-store and nosniff headers.

Limits: 15 MB/file, 20 PDF pages, 30 million source image pixels, 1 MB extracted text, 500 suggested lines, 30 seconds per Poppler command, 90 seconds OCR per page, and one active extraction at a time. Rasterized pages are scaled to a 2,400-pixel longest edge. Parser commands use `execFile` argument arrays and generated paths; uploaded strings never form shell commands.

Text PDFs use Poppler layout extraction. Pages with insufficient digital text are rendered and run through local Tesseract. PNG/JPEG inputs use local Tesseract directly. A failed parser/model leaves the original file available and sets a useful error; manual review remains available.

The deterministic parser recognizes labeled invoice headers and explicit quantity columns or quantity labels. Unsupported layouts retain raw text for manual entry. Monetary totals never become stock quantities. Numeric dates such as `04/10/2026` remain unconfirmed; ISO and unambiguous month names are recognized. OCR anomalies remain visible rather than being silently fixed. Source evidence has page/line/text, plus raw cells. Product matching uses a normalized-token inverted index and explicit match reasons, penalizes conflicting numeric variants and near ties, and never auto-approves a match.

## Queue

```ts
const hooks = {
  products: async () => (await getState(owner)).products,
  update: setInvoiceExtraction,
};
await recoverExtractionQueue(hooks); // once when the sole process starts
await queueExtraction(invoiceId, fileId, hooks); // persist and return immediately
```

`resumeExtractionQueue(hooks)` drains queued work without waiting on it in a request. `recoverExtractionQueue` also requeues interrupted working jobs and is startup-only. The database update callback must refuse to change approved/posted documents and must not alter reviewed lines or post stock. QUEUED/PROCESSING/COMPLETED/FAILED are extraction statuses, separate from approval status. A worker restart retries extraction, never approval.

## CSV

`parseCsv` accepts UTF-8 BOM, quoted commas, escaped quotes, embedded newlines and empty cells; it preserves raw values and physical source row numbers. Limits are 5 MB, 5,000 rows and 100 columns. `stringifyCsv` quotes every cell and neutralizes spreadsheet formulas in text cells. Its internal `safe=false` option is for exact data round-trip tests, not user downloads.

`previewProductImport(csv, products, mapping?)` returns headers, inferred/applied mapping, rows, warnings, errors and a file hash. Mapping keys are `id`, `sku`, `name`, `category`, `packaging`, `warehouseQuantity`, `price`, `minStock`, `active`, `currency`, `priceUnit`, `baseUnit`, `levels`, `packagingVersion`; each value is an exact header name.

`prepareProductImport(csv, products, mapping, decisions)` reparses the source server-side and returns `{preview, products, summary}`. Each decision is `{rowNumber, action:'create'|'update'|'skip', productId?, confirmPrice?, currency?, priceUnit?, confirmMinimumStock?}`. Products are validated `product.save` inputs (`id` on update). Root calls the atomic `product.import` action with those products and `preview.fileHash`.

Every row needs a decision. Existing candidate matches require update/skip, never silent duplicate creation. Unknown/unused source fields, source row, mapping, fingerprints and confirmations are retained in `rawImport`. Price is retained but priceUnit stays null until explicit confirmation. Positive minimum thresholds need policy confirmation. Packaging definitions can be previewed from complete exports but require the separate packaging form/action to apply them.

The supplied `Packaging=1` is unresolved, never a conversion ratio. `Warehouse=0` is a quantity without a destination identity, never a warehouse ID. It is retained as source data and never writes or overwrites live inventory. Source stock of zero creates no receipt.

The HTTP import route records a validated plan keyed to the actor and exact source/decisions before execution. A retry reuses this plan and the stock service idempotency record, so a response loss after creating products does not turn the retry into a duplicate import.

## Verification

```sh
node --experimental-strip-types --test tests/documents.test.mts
DOCUMENT_RUNTIME_TESTS=1 node --env-file=.env.local --experimental-strip-types --test tests/documents.test.mts
node --test tests/v2-http.test.mjs
```

Runtime tests use synthetic digital PDF, image and scanned PDF fixtures, actual Poppler/Tesseract and persistent queue lifecycle. The HTTP suite requires the separately started test server on `http://127.0.0.1:5174` connected to `sanket_test`; it refuses another host/port. It covers authentication, CSRF, private files, upload/import retries and conflicts, duplicate document hashes, extraction persistence, no extraction stock movements, role scope, exports and logout. Test credentials live outside outputs in `work/test-credentials.json` with mode 0600; never include that file in a distribution.
