# Inventory domain and correctness

The operational model lives exclusively in PostgreSQL schema `sanket`. Legacy `distribution` data is not copied, transformed or seeded. Initial setup creates the two named locations, two named godowns and three named vehicles; it never creates products, stock or salesmen.

## Code boundaries

- `lib/domain/validation.ts` validates every public action object with Zod, including whole quantities, UUIDs, date formats and resource limits.
- `units.ts` is the shared browser/server conversion formatter. Its descending divisibility chain gives an exact greedy decomposition in O(number of levels). Canonical stock is always an integer quantity in the immutable smallest unit.
- `common.ts` contains transaction helpers, business dates, exact quantity checks, Map-based aggregation and deterministic balance-row locking.
- `masters.ts`, `inventory.ts`, `invoices.ts` and `reports.ts` implement distinct workflows. `service.ts` supplies the authenticated transaction boundary and stable request idempotency. `state.ts` supplies role-scoped reads.
- Stock documents retain the product name, exact packaging version, labels, factors, entered unit/quantity and resulting base quantity. Database triggers protect historical snapshots, ledger movements, approval events and posted invoices.

## Posting invariants

All action calls require a stable request key. Actor + action + request key is unique; canonical JSON hashing rejects reusing that key with different input. A repeated successful request returns the original committed result.

A short PostgreSQL advisory transaction lock serializes multi-entity business mutations. Individual balance rows also lock in deterministic order. This deliberately favors correctness for this deployment; profile sustained throughput before replacing the global mutex with coordinated scope locks. Authentication updates that change permissions must acquire the same business lock.

Duplicate product lines aggregate in a Map before availability checks. Every balance update, document, ledger row, invoice transition, request result and audit entry commits in one database transaction. Failures roll everything back. Warehouse balances and vehicle balances are independent. Transfers deduct the home godown and add its vehicle in the same transaction. No operation allows negative stock or unsafe JavaScript integer arithmetic.

Manual/opening receipts require a delivery reference. Within a godown, whitespace/case-normalized references cannot duplicate prior manual/opening receipts or an approved invoice number/receipt reference. Invoice approval also rejects a matching earlier manual receipt. Historical references are read from immutable audit records. Deliberately different references cannot be identified as the same physical delivery automatically, so invoice-backed deliveries must use the invoice workflow.

Corrections preserve the original transaction. A sale can be replaced/voided only once; subsequent corrections target its replacement. A receipt correction is an owner `stock.adjust` with `sourceInvoiceId`: its godown and product must match the approved invoice, the new document links to the original receipt, and insufficient remaining godown stock rejects the entire adjustment.

## Packaging and pricing readiness

Packaging versions are append-only. Activating a version changes display conversion for new work and leaves base stock untouched. Old entered quantities retain their original conversion snapshots. Ordinary actions reject stale versions; invoice review may explicitly select historical packaging with a documented line reason. The canonical smallest unit cannot be changed through this screen. A confirmed price basis must remain a unit in the hierarchy.

A product with a preserved imported price but no confirmed price unit is not ready to post. Catalogue imports preserve source values and never post opening stock. Monetary accounting and GST are not part of this quantity ledger.

## Daily reports and assignments

Assignment history is effective-dated, with one active salesman per vehicle and one vehicle per salesman. Sales retain their original actor/assignment and home-godown ID. A vehicle with any remaining stock cannot change its home godown, preventing silent inventory relocation. A salesman sees own history and assigned vehicle stock, never godown balances, another salesman's reports, invoices, team accounts or business audit.

Report submission saves a new immutable JSON revision and seals only that vehicle/business date. Approve, reject and reopen append decisions; these actions never move stock. Expected revision and source hashes prevent acting on a stale preview. Rejection/reopening unseals the scope only when it is the current business day. Normal entries cannot backdate, and queued entries carry the originating day and assignment for server checks. An older sale needs an owner correction posted at the current time; the original date's as-of ledger remains intact. Later amendments are separately identified.

Approved snapshots keep original ratios and totals. Reopening keeps the prior approval event while requiring a new submission. A mid-day salesman reassignment that creates a combined vehicle day requires owner report review, preventing a new salesman from reading earlier private sales.

The actor-scoped request-resolution endpoint can look up or cancel a pending sale. Cancellation writes a permanent payload-matched tombstone under the same lock as sale posting, so a delayed original request cannot post after cancellation. A missing lookup alone is not authorization to discard/reissue.

Use `getReportRevision` for exported submitted/approved documents. `previewReport` is live and must be labeled draft. Bounded state responses return recent activity; `getHistory` provides server pagination and authorized filters, and `getWarehouseReconciliation` calculates the daily warehouse equation from indexed ledger groups; `getExportState` reads full role-scoped history for complete exports. All reads use database data, and user/session secrets are never selected.

## Integration tests

`tests/domain.integration.test.ts` requires `TEST_DATABASE_URL` naming a database ending in `_test`. It takes an advisory fixture lock and erases **that test database's** `sanket` schema before recreating synthetic fixtures. Never point it at application data. Example:

```sh
TEST_DATABASE_URL=postgresql://localhost/sanket_domain_test node --import tsx --test tests/domain.integration.test.ts
```

The suite covers exact mixed-unit boundaries/custom hierarchies, immutable packaging changes, invoice extraction without stock, duplicate invoices, stale revisions, concurrency/idempotency, multi-line rollback, vehicle/godown isolation, role and assignment scoping, linked corrections, day seals, report decisions/races, immutable snapshots, stale report sources, catalogue imports and ledger/balance reconciliation. It also verifies database mutation guards and account deactivation.

An actual PostgreSQL run on 4 October 2026 passed 15 test groups, followed by two additional focused groups for manual/invoice delivery deduplication and paginated literal text search. The suite caught and fixed a real business-date bug: `pg` decodes SQL DATE as local midnight, so converting it to UTC ISO first could incorrectly shift the date back in Asia/Kolkata. SQL DATE now retains its local year/month/day; timestamps still use UTC ISO.
