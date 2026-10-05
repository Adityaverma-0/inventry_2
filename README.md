# Sanket Distribution · FMCG van sales

A working Next.js and PostgreSQL application for two godowns, three vehicles, purchase invoice approval, configurable packaging, van sales and salesman daily report approval. The UI follows the supplied [Run-It reference](https://github.com/Adityaverma-0/Run-It), with the reference commit recorded in the supplied specification as `7be6df791b8c72d12d7185698c8e357f8605b41e`. Operational records use a new `sanket` schema; an existing `distribution` schema is never migrated or overwritten automatically.

## Open the local website

During this build the application runs at **http://127.0.0.1:5173**. Create your own admin account on the first screen. There are no default passwords, demo users, fabricated products or opening stock in the business database. Initial setup creates only your admin account. Add your own locations, godowns, vehicles and products; no business records are seeded.

The current machine's `.env.local` has private local database settings. Do not share it. The downloadable source excludes credentials, uploaded invoices and databases.

## Business workflow

1. Create salesman accounts and assign one active salesman to each vehicle.
2. Create products or preview/import the supplied CSV. Confirm each product's smallest unit, packaging hierarchy and price basis if used. CSV catalogue import never alters stock.
3. Upload a purchase PDF/PNG/JPEG. Digital text extraction or real OCR produces suggestions. Match products, select units and the receiving godown, enter the physical quantity, and review discrepancies.
4. Manual receipts require the original delivery reference; matching a posted receipt or invoice in the same godown is blocked in either posting order. Do not use a different reference to enter the same goods twice. Mark the reviewed invoice ready and approve that exact revision. Only approval adds stock. A duplicate upload or repeated approval cannot add stock twice.
5. Load a vehicle from its associated godown. The transfer deducts and adds the same base quantity atomically.
6. The salesman records sales against their assigned vehicle. Successful posting deducts stock immediately. Offline entries remain visibly pending until accepted by the server.
7. Generate and submit the day's report. Admin approves or rejects the exact saved revision. Rejected reports can be corrected and resubmitted; previous versions and reasons remain available. Report decisions never move inventory. Download an exact saved revision as a generated PDF or CSV; the PDF preserves the original packaging factors and includes page numbering.



## Cash Reconciliation
The Return/Unload workflow includes a "Count your cash" counter. Salesmen enter note and coin counts (e.g. ₹500, ₹200, coins). The system computes the total and compares against expected cash sales. Admin approval explicitly requires the total counted cash to perfectly match the expected sales; deviations must be sent back or managed as exceptions.

## Vehicle Scheduling
Admins can define a weekly recurring schedule for each vehicle to determine their route on a given weekday.

## Accounts
Salesman accounts utilize "Username" logins. Email is optional and not required for salesman routines.

## Packaging and data structures

`lib/domain/units.ts` is shared by forms, inventory, reports and exports. Stock is stored as exact whole smallest units. A validated descending divisibility chain supports greedy mixed-unit formatting in O(k), where k is the number of packaging levels. For 144 pieces per box and 12 per strip, 329 pieces is `2 Boxes + 3 Strips + 5 Pieces`. Changing to 100/10 keeps 350 pieces as 350 while displaying `3 Boxes + 5 Strips`.

Immutable packaging versions preserve historical transaction/report meaning. Maps aggregate product/location quantities and detect duplicate input in linear time. Invoice matching uses an inverted token index to shortlist catalogue matches. SQL indexes support stock identity, scopes, dates, assignments and request replay. A short transaction-level business lock plus balance row locks makes multi-record posting and report closure consistent; profile actual load before replacing it with finer locking.

## Run from source

Requires Node.js 24, PostgreSQL, Poppler (`pdftotext`, `pdfinfo`, `pdftoppm`) and the English OCR data in `runtime/ocr`. On macOS install PostgreSQL and Poppler with your preferred package manager; on Debian install `postgresql` and `poppler-utils`.

```sh
npm ci
cp .env.example .env.local
# Set DATABASE_URL, APP_URL, OWNER_SETUP_TOKEN and OCR paths.
npm run db:migrate
npm run dev
```

Use a real database you control. The migration command applies only `09x` and `1xx` migrations, under a database lock, with checksums. Never edit an applied migration; add a new one.

For a local Docker deployment, create an untracked `.env` containing URL-safe `POSTGRES_PASSWORD`, a random `OWNER_SETUP_TOKEN` of at least 32 characters and `APP_URL=http://127.0.0.1:5173`, then run `docker compose up --build -d`. Production mode asks for the setup token on first owner creation. Docker files are provided; Docker deployment is not claimed as tested unless recorded in `VERIFICATION.md`.

## Production operation

Use a long-running Node service, HTTPS reverse proxy, PostgreSQL and a persistent private `DATA_DIR` volume. Set `APP_URL` to the exact HTTPS origin, keep `OWNER_SETUP_TOKEN` secret, and run one application/queue worker replica with this local queue design. This is not a static site or an ephemeral serverless upload service. Multi-replica deployment needs shared durable object storage and a leased external job queue.

```sh
npm run build
npm start
```

`npm start` runs migrations before serving. Configure a 16 MB reverse-proxy body limit and request timeouts. The application independently caps invoice bytes, page count, image dimensions and extraction runtime. Private files require an active admin session and never live under `public/`. Passwords use scrypt; sessions use opaque hashed tokens in HttpOnly cookies. Password changes/deactivation revoke sessions. Account setup is protected by the deployment token outside explicitly enabled local development.

Back up PostgreSQL **and** `DATA_DIR` together. Example: use `pg_dump --format=custom` with a private environment-supplied connection string; stop writes or use a consistent backup window, and archive the private documents volume separately. Restore into a separate environment first, apply the same source/migrations, verify ledger/balance reconciliation and open sample invoice files before switching traffic. Keep environment secrets separate from backups shared with developers.

## Offline and location

The installed web shell can reopen offline after an online visit. Sales outbox entries are scoped to the signed-in account, preserve stable request IDs and show Pending/Failed/Confirmed status. Inventory shown offline is stale; the server validates stock, packaging version, assignment and business day again. A sealed day or changed assignment creates a visible conflict rather than silently changing a report. Online access is required for approvals, product configuration and report submission.

Location is permission-based foreground phone location, with accuracy and timestamps. It stops on logout and does not claim independent vehicle GPS or guaranteed background tracking. Denied location permission does not prevent sales.

## Source map

- `app/v2/`: responsive admin/salesman UI, forms, reports and offline outbox.
- `app/api/v2/`: authenticated HTTP boundaries, upload/import/export.
- `lib/domain/`: stock, packaging, invoice and daily report state machines.
- `lib/documents/`: protected storage, OCR/text extraction, conservative suggestions and CSV validation.
- `lib/server/`: sessions, authentication, database transactions and HTTP safety.
- `db/09x*`, `db/1xx*`: version 2 migrations.
- `tests/`: executable fixtures and invariant tests, isolated from business data.

The original repository README is retained in `reference-notes/Run-It-original-readme.md`. Old `/api/*` business endpoints return 410 so old clients cannot accidentally use a different inventory model. Optional legacy buyers/payments are not exposed as new FMCG features and require a deliberate migration if your existing production data uses them.

See `VERIFICATION.md` for executed checks and `ARCHITECTURE.md` for state transitions and implementation decisions.

## Run the checks

Use an isolated database ending in `_test` for domain fixtures; that suite rebuilds its test schema. `npm run test:documents` checks pure document utilities, `npm run test:ocr` includes real OCR, and `npm run test:domain` uses `TEST_DATABASE_URL`. For HTTP integration, run `npm run test:server` first, then `npm run test:http`. The test server uses the separate `sanket_test` database and `.data-test` directory. Create/migrate that database before the first run.

Generated test evidence and synthetic account credentials go under the ignored `work/` directory by default. `TEST_CREDENTIALS_PATH` and `TEST_OUTPUT_DIR` can override those locations. Preview HTTP checks reuse the credentials written by the main HTTP suite. `npm run lint`, `npm run typecheck`, and `npm run build` validate the application source and production bundle. See the verification record for the direct PDF/preview test commands and observed browser coverage.

## Warehouse returns and sale invoices

Open **Return to Warehouse** for holding stock or requesting a full/partial unload; open **Warehouse Stock** for home warehouse availability, allocation and discrepancy requests. Owners approve requests from their details. **Confirm & Print Invoice** posts through the existing sale flow and opens its immutable invoice. Reprint from Sales history. See [implementation and verification](docs/WAREHOUSE-ENHANCEMENTS.md), including the manual native print/PDF check and fields not supported by the existing financial model.
# Inventory-Managmnet
# inventry_managment_2
# inventry_managment_2
# inventry_2
