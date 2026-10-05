# Acceptance evidence — FMCG v2

Recorded on 4 October 2026. “Executed” means an actual command or interaction completed successfully. Implemented code alone is not marked passed. Desktop browser checks and direct PDF rendering are recorded in `../VERIFICATION.md`; remaining device-specific gaps stay explicit.

## Executed suites

- **D — PostgreSQL domain integration:** `TEST_DATABASE_URL=…/sanket_domain_test node --import tsx --test tests/domain.integration.test.ts` — **18/18 test groups passed on the final source**, including bidirectional manual/invoice delivery-reference protection, full-dataset literal search before pagination, and saved report metadata after master renaming. Dedicated local test database; synthetic fixtures only. The suite refuses database names not ending `_test`, obtains a fixture lock, and rebuilds only its test schema.
- **X — Document/CSV/runtime:** `DOCUMENT_RUNTIME_TESTS=1 node --env-file=.env.local --experimental-strip-types --test tests/documents.test.mts` — **9/9 passed**, confirmed by the document agent. Actual Poppler digital PDF extraction, Tesseract image OCR and scanned-PDF OCR ran; ambiguous OCR values were preserved and flagged.
- **H — HTTP application integration:** `node --experimental-strip-types --test tests/v2-http.test.mjs` — **10/10 passed** (9 subtests plus parent), confirmed by the document agent against isolated port 5174/database `sanket_test`, after migration 101. This exercises authentication, permissions, CSRF, uploads, extraction persistence, CSV import, inventory/report routes, exports and correction history.
- Targeted ESLint for the domain, history/reconciliation/request routes and domain integration test passed. Full application typecheck/build and interactive browser results are recorded by the lead reviewer separately; they are not inferred from these backend checks.

## Required 36 acceptance cases

| # | Required behavior | Actual evidence / status |
|---|---|---|
| 1 | Upload digital invoice, extract and preview without stock | **Executed X + H + D.** Real digital PDF extraction; authenticated upload/extraction; draft extraction leaves every stock balance unchanged. **Browser executed:** edited header, mapped product/unit, saved revision, marked ready, approved and observed posted receipt. |
| 2 | Scanned invoice real OCR, uncertainty and manual fallback | **Executed X.** Real image and scanned-PDF OCR; ambiguous candidate fields retain evidence/issues and require confirmation. **Browser executed:** editable invoice header and manual line mapping/physical quantity. |
| 3 | Salesman cannot approve purchase invoice | **Executed D + H.** Direct unauthorized service/API attempts denied. |
| 4 | Approve two 144-piece boxes into Hardpiplya only | **Executed D.** Exact 288-piece receipt; Dewas and vehicles remain unchanged. |
| 5 | Rejection has no stock; edited ready revision invalidates old approval | **Executed D + H.** Reject/update/status/revision guards and unchanged balances. |
| 6 | Repeated/concurrent/lost-response approval posts once | **Executed D.** Concurrent approval requests return the same receipt; exactly one purchase receipt and 288-piece increase. |
| 7 | Renamed duplicate file / same supplier invoice number detected | **Executed D + H.** File hash and normalized supplier-number uniqueness prevent duplicate receipt. |
| 8 | One unmatched/invalid invoice line prevents partial posting | **Executed D.** Multi-line invoice with an invalid product cannot become ready; target stock remains zero. |
| 9 | Receipt correction after goods move cannot go negative or erase history | **Executed D + H.** Linked adjustment rejects insufficient original-godown stock; permitted correction links original receipt/invoice; database blocks modifying approved invoice/posted line snapshots. |
| 10 | 1 box + 2 strips + 3 pieces = 171 | **Executed D.** Exact integer conversion assertion. |
| 11 | 329 / 288 / 72 / zero formatted correctly | **Executed D.** Expected strings: 2 Boxes + 3 Strips + 5 Pieces; 2 Boxes; 6 Strips; 0 Pieces. |
| 12 | Boundaries, optional levels, custom hierarchy | **Executed D.** B−1/B/B+1/S−1/S/S+1, piece-only product, and Carton/Box/Pack/Piece decomposition. |
| 13 | Change 144/12 to 100/10 without changing 350 base pieces | **Executed D.** 350 stays unchanged; live format changes from 2 Boxes + 5 Strips + 2 Pieces to 3 Boxes + 5 Strips. |
| 14 | Saved transaction/approved report keep old ratios; new preview uses new | **Executed D + H.** Original line factors and saved report strings remain unchanged; new live report adopts active version. |
| 15 | Invalid/fractional/zero/duplicate/overflow configuration and stale version rejected | **Executed D.** Invalid hierarchy, duplicate codes, fractional/zero factors, overflow, immutable base-unit change and stale posting all rejected. |
| 16 | Exact source CSV preserved without guessed stock/ratios; repeat safe | **Executed X + D + H.** `Allu Bhumiya`, `snaks`, raw `1`, price `200.00`, zero and boolean preserved; packaging null/readiness false; no stock overwritten/created; replay/duplicate rules enforced. |
| 17 | Load two boxes, sell 18 strips, retain 72 pieces | **Executed D.** Transfer deducts warehouse once; vehicle quantity 288 → 72. |
| 18 | Reject 73 when 72 remain, no partial effect | **Executed D.** Balance and posted records unchanged after rejected oversell. |
| 19 | Concurrent 60-piece sales against 100 | **Executed D.** Exactly one succeeds; remaining balance 40. |
| 20 | Sale retry deducts once; changed payload under same key rejected | **Executed D.** Stable result replay and payload-conflict guard. Cancellation-versus-posting race also verified with a persistent cancellation tombstone. |
| 21 | Modified vehicle/report IDs cannot expose another salesman | **Executed D + H.** Write scope, report read scope, history pagination/filter scope, assignment change, deactivation and private state tested. |
| 22 | Correct 18 strips to 17; retain linked history; no repeat reversal | **Executed D.** 72 → 84 pieces; linked replacement; second correction of original rejected. |
| 23 | Ledger and balances reconcile across all operation types | **Executed D.** SQL grouped movement sums equal every balance; daily warehouse equation also checked. |
| 24 | Scoped report submit appears pending without moving stock | **Executed D + H.** Saved submission status and zero additional ledger movements. |
| 25 | Salesman decisions denied; owner exact revision stores actor/time | **Executed D + H.** Role guard, exact revision, approver name/time and immutable decision event. |
| 26 | Reject reason visible, corrected resubmission retains earlier revision | **Executed D + H.** Rejection reason fetched; revision 2 submitted; revision 1 remains readable with its decision. |
| 27 | Stale reviewer / concurrent approve-reject safe | **Executed D.** v1 approval after v2 denied; one valid outcome in a decision race. |
| 28 | Approved PDF/CSV match saved rows/ratios/quantities after changes | **Executed D + H + PDF.** Exact-revision PDF preserves saved ratios and totals; one-page production PDF and nine-page long-product fixture rendered and visually checked. Desktop saved-report UI retains both revision choices after resubmission. |
| 29 | Sealed date blocks late writes; next-day work allowed | **Executed D.** Submitted-day sale rejected; explicit old-day queued payload rejected; next-day operation/correction tested with controlled clock. |
| 30 | 5 strips opening + 24 loaded − 18 sold = 11; multiple loads/date boundaries | **Executed D.** Previous-day carry 60 + two 144-piece loads − 216 = 132/11 Strips; next-day correction preserves approved as-of closing and shows a later amendment. Asia/Kolkata SQL DATE handling was exercised and a local-midnight conversion bug fixed. Exact UTC-midnight edge cases are not separately claimed. |
| 31 | Report transitions never alter inventory | **Executed D.** Movement count held constant across submit/reject/resubmit/approve/reopen. |
| 32 | Mobile sale/report and desktop invoice journey with keyboard/touch | **Desktop browser executed:** invoice draft→ready→approval; salesman sale→report submission; admin approval and preserved revision history, using keyboard/form controls. A 390 × 844 narrow layout was also visually inspected; full mobile/touch interactions remain unverified. |
| 33 | Reload/restart preserves data/files/versions/decisions | **Partly executed D + H.** Committed PostgreSQL records and private uploaded files were fetched across requests; persisted revisions/approvals remain intact. Application was rebuilt/restarted from development to production and records/files remained readable; browser reload and report history were exercised. |
| 34 | GPS denial/staleness visible without blocking sale | **Browser verification pending.** Device sharing is independent of sales; permission-denial and stale presentation need interactive evidence. |
| 35 | Cache/session isolation and protected invoice access | **Partly executed D + H.** Account/session and protected-file authorization verified. Browser IndexedDB/cache switching with unresolved drafts pending. |
| 36 | Spreadsheet-safe CSV and readable unclipped PDF/print | **Executed X + H + PDF.** Formula-safe CSV round trips passed. Generated PDF first/last pages, long-name wrapping, table headings, saved ratios and page numbering were rendered and visually inspected. Browser-native print is an optional separate route and not claimed. |

## Browser review handoff

The remaining pending rows identify device/browser checks not performed in this build; they are not inferred from backend test results. Real GPS hardware, background operation, production hosting, external credentials and production data migration are not covered by synthetic local tests.

Final release: full inventory/domain suite 18/18, documents 9/9, HTTP 10/10, PDF/preview utility checks 3/3 and private preview HTTP 1/1. Build, TypeScript and ESLint passed. Details and browser limitations are in `../VERIFICATION.md`.
