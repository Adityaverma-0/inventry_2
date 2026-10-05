# Shared implementation contract

This is a fresh v2 implementation inside the Next.js reference project. Keep the UI style/components. New operational tables live in `sanket` PostgreSQL schema, separate from any legacy `distribution` records. No production data is migrated automatically.

`lib/domain/types.ts` is the frontend/backend JSON contract. Root owns database adapter/auth and API routing. Backend agent owns `db/100_sanket.sql`, `lib/domain/{units,errors,service}.ts`, additional domain modules, core integration tests. UI agent owns `app/v2/**`, `app/page.tsx` and its scoped CSS. Document agent owns `lib/documents/**`, extraction/import utility tests and worker utilities. Coordinate any shared changes.

Root database adapter: `query<T = any>(text:string,values?:unknown[]):Promise<T[]>`; `transaction<T>(fn:(client:DbClient)=>Promise<T>):Promise<T>` with `DbClient.query(text,values)` returning `{rows,rowCount}`. Export `pool` and `migrate()`. Root creates auth tables in `db/090_auth.sql`: `sanket.users(id uuid, name,email,mobile,role owner/salesman,active,password_hash,created_at)`. Agent migrations may add fields only. Core service imports from `@/lib/server/database` and Actor from types. DomainError has status and code, no framework dependency.

Core exports: `getState(actor):Promise<AppState>`; `applyAction(actor,action,data,requestId):Promise<ActionResult>`; `previewReport(actor,day,vehicleId):Promise<DailyReport>`; `getReportRevision(actor,id,revision?):Promise<DailyReport>`; `packagingHistory(actor,productId)`.

Actions and payloads:
- location.save `{id?,name,active?}`; warehouse.save `{id?,name,locationId,active?}`; vehicle.save `{id?,name,registration?,warehouseId,active?}`; assignment.save `{vehicleId,salesmanId,reason?}`.
- product.save `{id?,sku?,name,category,active,minStock,price?,priceUnit?,currency?,rawImport?}`. Packaging separate; incomplete products remain not ready.
- packaging.save `{productId,baseUnit,levels:[{code,label,factor}],reason}` makes new immutable version; product balance untouched.
- stock.receive `{warehouseId,kind:'OPENING'|'MANUAL_RECEIPT',lines:QuantityInput[],notes,reference?}`; stock.adjust `{locationId,locationType,productId,delta,reason}`.
- transfer.create `{warehouseId,vehicleId,lines:QuantityInput[]}`; sale.create `{vehicleId,lines:QuantityInput[],notes?}`; sale.correct `{saleId,lines:QuantityInput[],reason,void?:boolean}`.
- report.submit `{vehicleId,day,notes,expectedSourceHash}`; report.approve/report.reject/report.reopen `{id,revision,reason?}`.
- invoice.create `{fileId,fileName,mime,hash,extractionStatus?,...}`; invoice.update `{id,revision,supplier,invoiceNumber,invoiceDate,warehouseId,lines:InvoiceLine[],reason?}`; invoice.ready/invoice.approve/invoice.reject `{id,revision,reason?}`. Internal extractor can write extractionStatus/extractedText/suggestions through a separately exported server-only method `setInvoiceExtraction(id,result)` (never a public action that can change stock).
- settings.save `{businessName,timezone,phone,address,trackingInterval,staleMinutes,retentionDays}`; location.record `{vehicleId,latitude,longitude,accuracy,capturedAt}`.

All action input objects must be runtime validated; owner or assignment scoped authorization; stable actor+action+requestId+payload hash; transaction and row locks; audit; no negative quantities; report transitions never move stock. Date helpers default Asia/Kolkata. Fresh account setup creates only the owner, without demo business records. State must not expose passwords/session secrets.

Source scope: `../../FMCG-full-website-build-prompt-v2.md` from this directory's root is actually `../FMCG-full-website-build-prompt-v2.md`; read the latter. The pasted attachment is identical scope. Human request adds smart DSA and clear maintainable code.
