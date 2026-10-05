# Sanket Distribution

A responsive wholesale FMCG distribution workspace with a restrained claymorphism interface. Uses React, Next.js, TypeScript and Neon PostgreSQL. No seed or demonstration records are included.

## Run locally

```sh
npm ci
cp .env.example .env
# Set DATABASE_URL, your OWNER_EMAIL, and a random OWNER_SETUP_TOKEN.
# Generate the setup token: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run db:migrate
npm run dev
```

Open http://127.0.0.1:5173 and choose **First-time owner setup**. Enter your real name, the configured owner email and setup token, and choose a password of at least 12 characters. No user or business records are created until you submit the form. Development and production use the same real authentication; there is no preview bypass.

Keep `OWNER_SETUP_TOKEN` private: it authorizes initial setup and owner password recovery. Staff cannot self-register.

## First working day

1. Settings → configure business details and add actual team members with their sign-in emails.
2. Products → enter the catalogue, base units, packaging ratios, prices and stock minimums.
3. Inventory → receive actual warehouse stock.
4. Vehicles → add vehicles and assign a worker or sales representative.
5. Loads → choose a vehicle, add products, review and confirm. Quantities use each product's base unit.
6. Vehicles → View → Dispatch vehicle. Sales require a dispatched vehicle for the current business day.
7. Sales → New sale. Select an existing buyer or enter the actual buyer's name and optional contact details. Add quantities, discount and payment. Prices and taxes are calculated again on the server.
8. Payments → select a buyer with an outstanding balance and record the collection. Collections are allocated to unpaid invoices, oldest first.
9. Reconciliation → count all stock and confirm HOLD or UNLOAD. No partial unload exists. Owners, warehouse managers and workers can record a shortage, with a reason.
10. On the next day, add a new load or use “Start day with held stock” to carry the retained stock forward without loading more.

## Roles and access

Owner, worker, warehouse manager, warehouse staff, sales manager, salesman and accountant have different navigation and permitted operations. Sales representatives can sell only from their assigned vehicles and can access only explicitly assigned buyers. Authorization is enforced on the server; changing visible navigation cannot grant access. In Settings → Team & access, add an actual team member, then use **Access link** to create a private activation link. Share that link with the intended person; no email is sent automatically. It expires after 24 hours, works once, and requires the registered email. A new link cancels the previous link and can also reset a forgotten password. Passwords use salted scrypt hashes; opaque session tokens are stored only as hashes. Sessions expire after seven days. Authentication has database-backed throttling that survives restarts.

Use the account avatar to change your password. Resetting or changing a password revokes previous sessions. Deactivating a user revokes their sessions and activation links immediately. Changing a user's email also removes their old password and requires a fresh access link. Owner recovery is available under Forgot password → Recover owner account using `OWNER_EMAIL` and `OWNER_SETUP_TOKEN`. Authentication never trusts browser-supplied identity headers.

## Buyer details within sales and payments

Routes and standalone Customers management have been removed. Buyer records remain internally so existing invoices, names, payments, credit limits and outstanding balances retain their identities. No buyer is replaced with a generic account. New buyer details are committed atomically with their first successful sale; a failed sale creates no orphan account. Select an existing buyer for repeat transactions. New buyers become selectable after synchronization.

Owners, workers and sales managers can explicitly set a buyer's credit limit within the sale form. Leaving the control off preserves existing limits; new buyers start at zero, requiring full payment. These roles can also explicitly select a representative under **Allow representative to sell and collect**. The grant applies only if the sale succeeds and exposes that buyer's balance and collection history to the selected representative. A representative entering a new paid buyer receives access to that buyer only and cannot change credit limits or grant access to others. Vehicle assignment is still enforced separately.

Migration `004_buyer_access.sql` copies each active sales representative's current route-based buyer access into explicit assignments exactly once. Later startups do not recreate revoked assignments. Legacy route/customer/visit tables and foreign keys remain for historical records, but routes and visits are no longer queried or required by application workflows. The stored vehicle status `ON ROUTE` continues to mean dispatched for compatibility with existing days and queued operations; it does not require a route record.

Existing queued sales and payments retain their `customer_id`, request UUID and payload format. Their normal permission, stock, credit and day checks still apply on synchronization. Invalid or stale queued transactions remain visible for review. The browser shell cache updates without clearing the transaction outbox.

## Worker dashboard and item types

In **Settings → Team & access**, add a real member with role **Worker**, then create their **Access link**. After activation, their Overview opens the worker dashboard. Workers can receive and adjust warehouse stock, manage products, load and operate every vehicle, record sales and collections, and reconcile stock. They can work on vehicles assigned to another worker. Team access and business settings remain owner-only.

**Item types** manages product categories and packaging units. Workers and owners can add and rename types; warehouse managers can too. Product forms let you choose an existing type or enter a new one. Renaming a type updates linked products without changing their quantities. The packaging unit names the base stock unit; box and carton ratios still define quantity conversions. No example types are preloaded. Existing real catalogue values are preserved during migration.

Confirmed changes share the same PostgreSQL data. Open dashboards refresh every 20 seconds while visible and online, and when the tab regains focus. Updates made offline reach the admin after synchronization. Inventory history records the person who performed each new movement; old movements without a known actor remain unattributed.

## Daily reports for the admin

The admin Overview includes worker submissions and a link to **Daily reports**. Reports are available for any business date in Asia/Kolkata and show sales, collections, opening/closing warehouse and vehicle stock, receipts, loading, sales quantities, returns, damage, losses and activity by the person who recorded it. Historical stock is reconstructed from the movement ledger; live product labels use the current catalogue. Today's report is activity so far. Use the stock, sales or team tab for CSV export or Print / PDF.

A worker selects the date, resolves pending transactions on their device, and chooses **Submit daily report**. The server saves a snapshot of the entire business day's confirmed figures, with the worker's notes and time of submission. The admin opens **View snapshot** and chooses **Mark reviewed**. Later transactions update the live report, not the saved snapshot. Resubmitting replaces that worker's saved snapshot for the date, increments its version, and requires a fresh review; a stale review cannot approve a newer version. Reports are available in the dashboard; no automatic email is sent.

## Data integrity

- Tables are isolated in the `distribution` PostgreSQL schema.
- Stock/payment operations run in a single PostgreSQL function transaction, with a transaction-level advisory lock and row locks.
- Warehouse and vehicle balances cannot be negative.
- Sales cannot exceed vehicle stock or the customer's credit limit.
- Payment collection cannot exceed outstanding balance.
- Multi-product operations roll back completely on any failure.
- HOLD retains stock. UNLOAD returns every remaining product and closes with zero vehicle stock.
- Each confirmed operation is audit logged and idempotent by request UUID and payload.
- State is read in a repeatable-read snapshot.
- Currency uses PostgreSQL decimal values; business dates use Asia/Kolkata.
- History is immutable through the UI. Stock is adjusted by explicit receipt, damage, or reconciliation records.

## Offline operation

In the production build, after one authenticated online visit, the app shell and last authorized snapshot are cached on the device. Sales and payments can be saved to an IndexedDB outbox. Pending sales reserve locally available stock. Each transaction shows Pending or Failed until confirmed; sync runs on reconnection and can be retried in Sync center. UUID idempotency prevents duplicates after ambiguous network failures. The server rechecks stock, day, role and credit on sync. Permanently rejected transactions can be removed with confirmation and entered again; ambiguous failures remain retryable. Sign-out is blocked until pending transactions are resolved and clears the device cache.

Install through your browser's Add to Home Screen / Install option when supported. Offline operation requires an initial online load; a brand-new device cannot sign in while offline. Closed-day or stale-stock conflicts require review; the app never claims rejected transactions succeeded.

## Reports and exports

Daily sales, vehicle sales, salesman performance, product sales, warehouse stock, outstanding customers, payment collection, reconciliation, stock movement, low stock, damage/loss. Filters use the report's relevant dimensions. CSV exports escape spreadsheet formula prefixes. PDF export uses the browser's print/save-as-PDF dialog. Invoice printouts use recorded line-item prices and amounts. All displayed statistics derive from database records.

## Verification

```sh
npm run typecheck
npm run test:auth
npm run build
node scripts/test-db.mjs
# With the production server running locally on port 5173:
node tests/http-smoke.mjs
```

The integration test creates an isolated test schema inside a transaction and rolls the entire schema and fixtures back. It never inserts fixtures into application tables. It also checks owner setup/recovery, one-time/expired access links, session revocation, inactive users and authentication throttling. Removal regression checks cover one-time access migration, unchanged legacy invoices/receipts, revoked access on repeated migration, inline buyer creation, credit/access permissions, atomic rollback, removed actions, and legacy offline retries. Worker checks cover access restrictions, all-vehicle operations, category/unit naming, movement attribution, daily arithmetic, historical balances, snapshot retries and versioned admin review. It checks overselling, warehouse limits, credit limits, discounted tax, overpayment, invoice allocation, unauthorized roles, idempotent retries, HOLD carry-forward, next-day dispatch, complete UNLOAD and stock conservation.

The isolated SQL integration tests require the PostgreSQL `psql` CLI. Normal migrations and deployment use the Node PostgreSQL client and do not need `psql`. Development bypasses service-worker caching so edits appear immediately.

## Deploy on Render

Create a **Node Web Service**, with these fields:

| Field             | Value                                   |
| ----------------- | --------------------------------------- |
| Branch            | `main`                                  |
| Root directory    | `distribution`                          |
| Build command     | `npm ci --include=dev && npm run build` |
| Start command     | `npm start`                             |
| Health check path | `/api/health`                           |

Add server environment variables:

- `DATABASE_URL`: your Neon PostgreSQL connection string, including its SSL parameters.
- `OWNER_EMAIL`: your real owner email address.
- `OWNER_SETUP_TOKEN`: a private random secret of at least 32 characters. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` or Render's secret generator.
- `NODE_VERSION`: `22`.
- `NODE_ENV`: `production`.
- Optional `APP_URL`: the exact HTTPS origin if you use a custom domain. For the default Render domain, the app uses Render's automatic `RENDER_EXTERNAL_URL` value. Requests must originate from this canonical origin.

The repository-root `render.yaml` contains the equivalent Blueprint configuration; choose **New → Blueprint** to use it instead of the manual form. The Blueprint generates `OWNER_SETUP_TOKEN` automatically; retrieve it from the service's environment settings for first setup.

`npm start` applies the idempotent migrations in one transaction, then starts Next.js on `0.0.0.0` using Render's `PORT` (default `10000`). A failed migration stops startup rather than starting a broken app. `/api/health` checks the database, authentication, worker/report and buyer-access tables without disclosing connection details. Migrations use transaction-level locking compatible with Neon's pooled endpoint. No seed data is added. All 25 tables are in the **distribution** schema; select that schema in Neon's Tables view.

After the deployment becomes healthy, open its HTTPS URL and complete **First-time owner setup**. The app then opens an empty workspace ready for your actual records. Keep the setup secret private and rotate it if it is exposed.

Push the updated source to your connected repository before deploying. This workspace change does not itself upload or publish the application. Do not put secrets in `NEXT_PUBLIC_*` variables, source control, logs or browser bundles. The local `.env` is ignored. The old Sites/Worker tooling is unused by the default build and start commands.

## Practical limits

The app currently serves one business and one warehouse. The state endpoint returns its authorized history in one snapshot, which suits a small distribution operation; add server-side pagination and aggregate endpoints before very large datasets. Offline synchronization has been implemented but should also be acceptance-tested on the actual field devices and networks. Staff activation and recovery use owner-generated links; no email delivery service is configured. Installation prompts are provided by the browser.
