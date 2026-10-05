# Warehouse and sales enhancements

## Implementation plan

The existing `applyAction` service validates actions, serializes business writes, checks roles, stores stable request outcomes and audits successful changes. `inventoryAction`, `createDocument` and `move` own stock changes; balances and immutable movements are already authoritative. Sales currently record quantities, without customer, payment or tax calculations. Daily reports seal a vehicle's date and preserve snapshots. The UI uses shared components, hash navigation and periodic refresh.

1. Add one migration for approval requests and immutable sales-invoice snapshots. Preserve all current records and migrations.
2. Add a separate stock-request domain module. Salesmen submit returns, additional loads or discrepancy requests; owners approve/reject. Holding stock completes without movement. Approval rechecks the assignment, date seal, product packaging and available stock; return debit/credit uses the existing ledger transaction. Pending requests do not reserve stock.
3. Add a scoped warehouse endpoint: only the home warehouses of a salesman's current vehicles, aggregate allocated stock, current own-vehicle quantities, day movements and paginated own request history. Keep existing state permissions intact.
4. Add a sales-invoice snapshot inside the existing sale transaction. Snapshot known product prices using integer minor-unit arithmetic, price-unit factors and per-line rounding. Preserve quantity-only selling when price is unavailable. Customer details are optional; payment, discount and tax are marked unrecorded because those systems do not exist. Legacy sales display original quantities without inventing historical prices.
5. Add Return to Warehouse and Warehouse Stock pages using existing UI components and refresh behavior. Owner decisions use review confirmations. Add Confirm & Print alongside existing confirmation, and searchable sales invoice history. Printing retrieves only the saved transaction and cannot create stock movements.
6. Test partial/full returns, holds, rejection, retries, concurrency, permissions, stale assignments, sealed days, immutable prices, printing/retrieval and existing workflows. Run lint, types and production build.

## Integration boundaries

Existing files need small additions: action validation/dispatch; sale invoice capture; sales history search metadata; navigation; sale form/history print actions. New modules contain request workflows, warehouse views and invoice rendering. New endpoints use current sessions and private no-store responses. No customer/payment/tax system is replaced. The pending Neon migration choice is separate; this work preserves the currently configured database and does not reset it.

## Delivered features

- Return to Warehouse: current quantities, opening/carried stock, today's allocations, net sales, unloaded quantity; full/partial unloading requests and hold-all confirmation. Every unrequested unit remains in the vehicle.
- Owner approval or rejection for unloads, stock allocations and signed base-unit discrepancy requests. Pending requests have no stock effect and do not reserve stock. Approval rechecks current stock, home warehouse, assignment, current packaging and the current date's report seal.
- Scoped warehouse visibility: home warehouses only for salesmen, warehouse available stock, aggregate vehicle holdings, combined physical stock, last warehouse movement, product/SKU search and category filters. Owners can see all authorized locations.
- Paginated request history, submission/completion quantities, approval identity, reason and linked stock document. Completed records cannot be edited. Request retry payloads survive browser refresh in local storage.
- Existing confirmation remains; Confirm & Print calls the same sale action and then opens a dedicated A4 invoice. All newly posted sales capture immutable product prices, unit factors, customer details and company/contact details. Print/reprint endpoints are read-only and restricted to the owner or original salesman.
- Sales history searches invoice number, customer/phone, salesman or sale reference, alongside existing date/vehicle filters. Corrections retain original invoices and point to the replacement.
- Existing notifications and overview include pending stock requests. Existing refresh updates both dashboards. Existing report equations remain unchanged: vehicle returns appear as negative signed adjustments; warehouse reconciliation uses its existing returns column.

## Files changed and rationale

| Existing file | Integration |
| --- | --- |
| `lib/domain/validation.ts` | Strict schemas for stock requests/decisions; optional customer information on the existing sale action. |
| `lib/domain/service.ts` | Dispatch request actions through the existing idempotent, audited transaction boundary. |
| `lib/domain/inventory.ts` | Capture invoice snapshots in the same sale/correction transaction, with no second stock deduction. |
| `lib/domain/history.ts` | Join invoice metadata and search invoice/customer/salesman fields before pagination. |
| `lib/domain/types.ts` | Optional sale invoice metadata and pending request count. |
| `lib/domain/state.ts` | Scoped pending request count; existing balance visibility remains intact. |
| `app/v2/ui.tsx` | Add two page identifiers, reusing existing components. |
| `app/v2/workspace.tsx` | Add navigation, page views and pending request indicators. |
| `app/v2/operations.tsx` | Optional customer fields, second confirmation action, invoice history search and saved-invoice link. |
| `app/v2/settings.tsx` | Pending stock-request notification. |
| `app/v2/reports.tsx` | Explain where return quantities appear in the unchanged closing-stock equation. |
| `tests/domain.integration.test.ts` | Return/allocation/concurrency/authorization/invoice regression coverage. |

## New files

- `db/103_stock_requests_sales_invoices.sql`: additive tables, indexes and immutable-history triggers. No existing columns/tables/records removed or replaced.
- `lib/domain/stock-requests.ts`: scoped warehouse reads and request/decision workflows using existing stock services.
- `lib/domain/sales-invoices.ts`: immutable invoice capture, exact integer money arithmetic and authorized retrieval.
- `app/api/v2/warehouse-stock/route.ts`: authenticated stock and paginated request history.
- `app/api/v2/sales/[id]/invoice/route.ts`: authenticated read-only invoice retrieval.
- `app/v2/warehouse.tsx`: responsive return, warehouse, request and approval views.
- `app/sales-invoice/[id]/page.tsx`, `view.tsx`, `print.css`: dedicated A4 invoice view and browser print action.
- `tests/warehouse-http.test.mjs`: authenticated HTTP checks for the complete new flow.
- This document: architecture, changes, verification and limitations.

## Routes and actions

- `GET /api/v2/warehouse-stock?vehicleId=<optional>&page=1`.
- Existing `POST /api/v2/action` accepts `inventory-request.create`, `.approve`, `.reject`; stable `requestId` remains mandatory.
- `GET /api/v2/sales/:id/invoice` and display route `/sales-invoice/:id`.
- New hash pages `#returns` and `#warehouse-stock`.

## Verification on 4 October 2026

- 23 domain tests passed (19 existing plus four comprehensive enhancement scenarios).
- 10 existing production HTTP workflow tests passed.
- One new comprehensive production HTTP test passed: scoped visibility, permission rejection, allocation, partial unload, rejection, sale retry, invoice totals and repeated read-only invoice retrieval.
- ESLint, TypeScript and production build passed.
- Browser verified using isolated test data: salesman dashboard navigation; mixed Box/Piece stock; hold review and completion without changing vehicle quantity; both sale confirmation actions; Confirm & Print opening the correct saved invoice, customer and amount.
- Native print dialog inspection timed out in the embedded browser. Access to the native Codex app is restricted by the computer-use tool. Browser print and Save PDF completion are therefore **not verified**; use the invoice's Print / Save PDF button for the final manual check.
- Existing local database backed up privately before applying migration 103. Counts in all pre-existing business tables were unchanged after migration. No test fixtures were inserted into the live database.

## Configuration and limits

The app remains on its existing local PostgreSQL database. The earlier Neon cutover still awaits the user's explicit empty-workspace versus selective-migration decision; this feature work did not transfer or reset existing data.

The existing project has no payment ledger, discount/tax calculation, GST business profile, company-logo upload or order reservations. Invoices accurately show those fields as unrecorded rather than inventing zero tax or a paid status. Customer name, phone, address and GSTIN can now be supplied optionally at sale entry. Old sales have no historical price snapshot, so legacy printouts preserve their quantities and clearly disclose unavailable historical pricing. No tax-compliance claim is made by this quantity-sales extension.

Pending requests do not reserve stock; another confirmed sale/load can change availability before approval. An unavailable, stale or discontinued product blocks posting with a validation error; an owner can reject the request and resolve product setup. After reassignment, the original salesman retains their own request/invoice history but cannot move the reassigned vehicle's stock. Business writes keep the existing serialization lock plus deterministic stock-row locking. Map-based product lookup and duplicate-line aggregation prevent competing quantities from being validated separately.
