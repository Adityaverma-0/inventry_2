"use client";
import { CashCounter } from "./cash";
import { DENOMINATIONS, calculateBreakdownTotal, summariseBreakdown, compareWithExpectedCash } from "@/lib/domain/cashDenominations";
import { useEffect, useMemo, useState } from "react";
import { Check, Download, Eye, Printer } from "lucide-react";
import type {
  DailyReport,
  Sale,
  Transfer,
  Movement,
  PurchaseInvoice,
  ReportLine,
} from "@/lib/domain/types";
import {
  api,
  businessDay,
  dateTime,
  downloadCsv,
  outboxList,
  useMutation,
  useHistory,
} from "./client";
import {
  HistoryPagination,
  Badge,
  Button,
  DataTable,
  ErrorNotice,
  Field,
  formatLevels,
  Input,
  Modal,
  Panel,
  quantity,
  useApp,
} from "./ui";
export function DailyReportsPage() {
  const { state, online, notify, refresh } = useApp();
  const [day, setDay] = useState(businessDay(state));
  const [vehicle, setVehicle] = useState(state.vehicles[0]?.id || "");
  const [status, setStatus] = useState("");
  const history = useHistory<DailyReport>(
    "reports",
    { status },
    state.serverTime,
  );
  const [selected, setSelected] = useState<DailyReport | null>(null);
  const [preview, setPreview] = useState<DailyReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [cashBreakdown, setCashBreakdown] = useState<Record<string, number>>({});
  const [cashTotalPaise, setCashTotalPaise] = useState(0);
  const mutation = useMutation(refresh);
  async function openReport(report: DailyReport, revision = report.revision) {
    setBusy(true);
    setError("");
    try {
      setSelected(
        await api<DailyReport>(`/report/${report.id}?revision=${revision}`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report could not be loaded");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="sd-grid sd-grid-equal" style={{ marginBottom: 22 }}>
        <Panel
          title="Generate a day report"
          subtitle="Server-calculated quantities for one business date and vehicle"
        >
          <div className="sd-form">
            <Field label={`Business date · ${state.settings.timezone}`}>
              <Input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                required
              />
            </Field>
            <Field label="Vehicle">
              <select
                value={vehicle}
                onChange={(e) => setVehicle(e.target.value)}
                required
              >
                {state.vehicles.map((v) => (
                  <option value={v.id} key={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="sd-form-actions">
            <Button
              disabled={!online || !vehicle}
              busy={busy}
              onClick={async () => {
                setError("");
                setBusy(true);
                try {
                  setPreview(
                    await api<DailyReport>(
                      `/report?day=${day}&vehicleId=${vehicle}`,
                    ),
                  );
                  setNotes("");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Preview failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Eye size={15} />
              Generate preview
            </Button>
          </div>
        </Panel>
        <Panel
          title="From review to a closed day"
          subtitle="Every decision applies to the exact submitted revision"
        >
          <div className="sd-split-row">
            <span>Submitted · pending owner review</span>
            <Badge tone="amber">
              {state.reports.filter((r) => r.status === "SUBMITTED").length}
            </Badge>
          </div>
          <div className="sd-split-row">
            <span>Corrections requested</span>
            <Badge tone="red">
              {
                state.reports.filter(
                  (r) => r.status === "REJECTED" || r.status === "REOPENED",
                ).length
              }
            </Badge>
          </div>
          <div className="sd-split-row">
            <span>Approved reports</span>
            <Badge tone="green">
              {state.reports.filter((r) => r.status === "APPROVED").length}
            </Badge>
          </div>
        </Panel>
      </div>
      <ErrorNotice error={error} />
      <Panel
        title="Daily report history"
        subtitle="Saved snapshots · previous versions remain available"
      >
        <div className="sd-tabs">
          {[
            ["", "All reports"],
            ["SUBMITTED", "Pending approval"],
            ["APPROVED", "Approved"],
            ["REJECTED", "Corrections"],
            ["REOPENED", "Reopened"],
          ].map(([s, label]) => (
            <button
              key={s}
              className={status === s ? "active" : ""}
              onClick={() => setStatus(s)}
            >
              {label}
            </button>
          ))}
        </div>
        <DataTable
          headers={[
            "Business date",
            "Vehicle",
            "Submitted by",
            "Revision",
            "Decision",
            "Action",
          ]}
          rows={history.items
            .filter((r) => !status || r.status === status)
            .map((r) => [
              r.day,
              r.vehicleName,
              r.salesmanName,
              `v${r.revision}`,
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <div>
                <Badge>{r.status}</Badge>
                {r.decisionReason && (
                  <small className="sd-sub">{r.decisionReason}</small>
                )}
              </div>,
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <Button
                variant="secondary"
                busy={busy}
                onClick={() => openReport(r)}
              >
                Review / history
              </Button>,
            ])}
        />
        <HistoryPagination {...history} />
      </Panel>
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={`Daily report preview · ${preview?.day || ""}`}
        description="This live draft is calculated from posted transactions. Submission creates an immutable snapshot."
        wide
      >
        {preview && (
          <>
            <ReportDetail report={preview} />
            <CashCounter maxAmount={preview.cashExpected} onChange={(b, t) => { setCashBreakdown(b); setCashTotalPaise(t); }} />
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                try {
                  const pending = await outboxList(state.user.id);
                  if (
                    pending.some(
                      (p) => p.state === "Pending" || p.state === "Failed",
                    )
                  )
                    throw new Error(
                      "Resolve pending or failed sales in Sync Center before submitting this report.",
                    );
                  await mutation.run("report.submit", {
                    vehicleId: preview.vehicleId,
                    day: preview.day,
                    notes,
                    expectedSourceHash: preview.sourceHash,
                  });
                  notify(
                    "Daily report submitted for owner approval. This vehicle-day is now closed to ordinary entries.",
                  );
                  setPreview(null);
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : "Submission failed",
                  );
                }
              }}
            >
              <Field label="Submission notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Add any exceptions or details for the owner"
                />
              </Field>
              <label className="sd-check" style={{ marginTop: 18 }}>
                <input type="checkbox" required />I reviewed this report and
                resolved all pending sales on this device.
              </label>
              <div className="sd-notice">
                Submitting closes ordinary posting for this vehicle on{" "}
                {preview.day}. Your next business day remains open. Report
                submission does not deduct stock.
              </div>
              <ErrorNotice error={error || mutation.error} />
              <div className="sd-form-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => window.print()}
                >
                  <Printer size={14} />
                  Print draft
                </Button>
                <Button disabled={!online} busy={mutation.busy}>
                  Submit for owner approval
                </Button>
              </div>
            </form>
          </>
        )}
      </Modal>
      {selected && (
        <SavedReport
          report={selected}
          latestRevision={
            history.items.find((r) => r.id === selected.id)?.revision ||
            state.reports.find((r) => r.id === selected.id)?.revision ||
            selected.revision
          }
          onClose={() => setSelected(null)}
          onReload={(r) => openReport(r)}
          onRevision={(n) => openReport(selected, n)}
        />
      )}
    </>
  );
}
export function CashBreakdownTable({ breakdown, expected }: { breakdown?: Record<string, number> | {key?: string, denomination?: string, count: number}[], expected?: number }) {

  if (!breakdown || (Array.isArray(breakdown) && breakdown.length === 0) || Object.keys(breakdown).length === 0) {
    return <div className="mt-4 text-gray-500 italic">Breakdown not recorded.</div>;
  }
  const breakdownDict = Array.isArray(breakdown)
    ? breakdown.reduce((acc, curr) => ({...acc, [curr.denomination || curr.key || ""]: curr.count}), {} as Record<string, number>)
    : breakdown;

  const { noteCount, coinCount } = summariseBreakdown(breakdownDict);
  const totalAmount = calculateBreakdownTotal(breakdownDict);
  let statusStr = "";
  if (expected !== undefined && expected !== null) {
      const comp = compareWithExpectedCash(totalAmount, expected);
      statusStr = comp.status === "MATCH" ? "MATCH" : `${comp.status} by ₹${(comp.difference / 100).toFixed(2)}`;
  }

  return (
    <div className="mt-6">
      <h3 className="font-semibold mb-2">Cash Received</h3>
      <table className="w-full text-sm border-collapse border">
        <thead>
          <tr className="bg-gray-50">
            <th className="border p-2 text-left">Denomination</th>
            <th className="border p-2 text-right">Count</th>
            <th className="border p-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {DENOMINATIONS.map(d => {
            const count = (breakdownDict as Record<string, number>)[d.key] || 0;
            if (count > 0) return (
              <tr key={d.key}>
                <td className="border p-2 text-left">{d.label}</td>
                <td className="border p-2 text-right">{count}</td>
                <td className="border p-2 text-right">₹{((count * d.value)).toFixed(2)}</td>
              </tr>
            );
            return null;
          })}
        </tbody>
        <tfoot className="font-bold bg-gray-50">
          <tr>
            <td colSpan={3} className="border p-2">
              <div className="flex justify-between">
                <span>Notes: {noteCount} | Coins: {coinCount}</span>
                <span>Total Cash: ₹{(totalAmount / 100).toFixed(2)}</span>
              </div>
              {statusStr && <div className="mt-1 text-right text-gray-600">Reconciliation: {statusStr}</div>}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
export function ReportDetail({ report }: { report: DailyReport }) {
  const reportTimezone = report.timezone || "UTC";
  return (
    <div className="sd-report-panel">
      <div className="sd-print-heading">
        <h1>
          {report.businessName || "Business name not captured"} · Daily stock
          report
        </h1>
      </div>
      <div className="sd-report-meta">
        <div>
          <h2>
            {report.vehicleName} · {report.day}
          </h2>
          <p>
            {report.businessName ||
              "Business name not captured in this revision"}
            <br />
            Godown: {report.warehouseName || "Not captured in this revision"}
            <br />
            Location: {report.locationName || "Not captured in this revision"}
            <br />
            {report.salesmanName} ·{" "}
            {report.timezone ||
              "Times shown in UTC; original timezone not captured"}
            <br />
            Report {report.id || "live draft"} · revision{" "}
            {report.revision || "draft"}
          </p>
        </div>
        <div>
          <Badge>{report.status}</Badge>
          <p>
            {report.submittedAt
              ? `Submitted ${dateTime(report.submittedAt, reportTimezone)}`
              : "Live draft · not yet submitted"}
            <br />
            {report.decidedAt
              ? `Decision: ${dateTime(report.decidedAt, reportTimezone)} by ${report.approval?.actor || report.decidedBy}`
              : ""}
          </p>
        </div>
      </div>
      <DataTable
        headers={[
          "Product / packaging snapshot",
          "Opening",
          "Loaded",
          "Gross sold",
          "Reversed",
          "Adjustments",
          "Closing base",
          "Closing quantity",
        ]}
        rows={report.lines.map((l) => [
          // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
          <div>
            <strong>{l.productName}</strong>
            <small className="sd-sub">
              {l.levels
                .map((v) => `${v.label} = ${v.factor} ${l.baseUnit}`)
                .join(" · ")}
            </small>
            <small className="sd-sub sd-mono">
              {l.packagingId?.slice(0, 8) || "No configuration"}
            </small>
          </div>,
          ...[l.opening, l.loaded, l.sold, l.reversed, l.adjustments].map(
            (n) => (
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <div>
                {formatLevels(n, l.levels, l.baseUnit)}
                <small className="sd-sub">{n} base units</small>
              </div>
            ),
          ),
          `${l.closing} ${l.baseUnit}`,
          // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
          <strong>
            {l.formatted || formatLevels(l.closing, l.levels, l.baseUnit)}
          </strong>,
        ])}
        empty="No product movements or carried stock for this day"
      />
      <div className="sd-notice">
        Closing = opening + loads − gross sold + reversals + signed adjustments.
        Confirmed vehicle returns are included as negative signed adjustments.
        This is ledger stock, not a verified physical count.
      </div>
      {report.notes && (
        <p className="sd-notice">Submitter notes: {report.notes}</p>
      )}
      {report.decisionReason && (
        <div className="sd-notice sd-warning">
          Owner decision: {report.decisionReason}
        </div>
      )}
      {report.amendments?.length ? (
        <details>
          <summary className="sd-text-link">
            Later linked amendments ({report.amendments.length})
          </summary>
          <pre className="sd-extracted">
            {JSON.stringify(report.amendments, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
function SavedReport({
  report,
  latestRevision,
  onClose,
  onReload,
  onRevision,
}: {
  report: DailyReport;
  latestRevision: number;
  onClose: () => void;
  onReload: (r: DailyReport) => void;
  onRevision: (n: number) => void;
}) {
  const { state, refresh, notify, online } = useApp();
  const [decision, setDecision] = useState<
    "approve" | "reject" | "reopen" | null
  >(null);
  const mutation = useMutation(refresh);
  const current = report.revision === latestRevision;
  return (
    <Modal
      open
      onClose={onClose}
      title="Saved daily report"
      description="Quantities and packaging are preserved exactly as submitted for this revision."
      wide
    >
      <div className="sd-toolbar">
        <Field label="Saved revision">
          <select
            value={report.revision}
            onChange={(e) => onRevision(Number(e.target.value))}
          >
            {Array.from({ length: latestRevision }, (_, i) => (
              <option value={i + 1} key={i}>
                Revision {i + 1}
                {i + 1 === latestRevision ? " · latest" : ""}
              </option>
            ))}
          </select>
        </Field>
        <a
          className="sd-btn sd-secondary"
          href={`/api/v2/export?kind=reports&reportId=${report.id}&revision=${report.revision}`}
        >
          <Download size={14} />
          Export this revision
        </a>
        <a
          className="sd-btn sd-secondary"
          href={`/api/v2/report/${report.id}/pdf?revision=${report.revision}`}
        >
          <Download size={14} />
          Download saved PDF
        </a>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={14} />
          Print / save PDF
        </Button>
      </div>
      {!current && (
        <div className="sd-notice sd-warning">
          Historical revision. A newer report revision exists; decisions are
          available on the latest revision only.
        </div>
      )}
      <ReportDetail report={report} />
      <details>
        <summary className="sd-text-link">
          View related transaction references
        </summary>
        <DataTable
          headers={["Reference", "Type", "Posted", "Status"]}
          rows={(report.transactionReferences || []).map((t) => [
            t.reference,
            t.kind,
            dateTime(t.createdAt),
            "Saved source record",
          ])}
        />
        <p className="sd-legend">
          These source references were captured with this saved report revision.
        </p>
      </details>
      {!!report.decisionHistory?.length && (
        <details>
          <summary className="sd-text-link">Decision history</summary>
          <DataTable
            headers={["Decision", "By", "When", "Reason"]}
            rows={report.decisionHistory.map((d) => [
              d.decision,
              d.actor,
              dateTime(d.at),
              d.reason,
            ])}
          />
        </details>
      )}
      {state.user.role === "owner" && current && (
        <div className="sd-form-actions sd-no-print">
          {report.status === "SUBMITTED" && (
            <>
              <Button
                variant="danger"
                disabled={!online}
                onClick={() => setDecision("reject")}
              >
                Reject / request corrections
              </Button>
              
              <Button disabled={!online || (report.cashExpected != null && report.cashExpected !== report.cashActual)} onClick={() => setDecision("approve")} title={(report.cashExpected != null && report.cashExpected !== report.cashActual) ? "Cannot approve: Cash discrepancy" : ""}>
                <Check size={14} />
                {(report.cashExpected != null && report.cashExpected !== report.cashActual) ? "Cash Mismatch" : "Approve this revision"}
              </Button>

            </>
          )}
          {report.status === "APPROVED" && (
            <Button
              variant="secondary"
              disabled={!online}
              onClick={() => setDecision("reopen")}
            >
              Reopen with reason
            </Button>
          )}
        </div>
      )}
      <Modal
        open={!!decision}
        onClose={() => setDecision(null)}
        title={`${decision === "approve" ? "Approve" : decision === "reject" ? "Request corrections for" : "Reopen"} revision ${report.revision}`}
        description={`${report.vehicleName} · ${report.day}`}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              const r = await mutation.run(`report.${decision}`, {
                id: report.id,
                revision: report.revision,
                reason: f.get("reason") || "",
              });
              notify(r.message);
              setDecision(null);
              onReload(report);
            } catch {}
          }}
        >
          <div className="sd-notice">
            This decision applies only to this saved report revision. It does
            not create any stock movement.
          </div>
          <Field
            label={
              decision === "approve"
                ? "Approval note (optional)"
                : "Required reason"
            }
          >
            <textarea
              name="reason"
              required={decision !== "approve"}
              minLength={decision !== "approve" ? 3 : undefined}
              rows={3}
            />
          </Field>
          <ErrorNotice error={mutation.error} />
          <div className="sd-form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDecision(null)}
            >
              Cancel
            </Button>
            <Button
              busy={mutation.busy}
              variant={decision === "reject" ? "danger" : "primary"}
            >
              Confirm decision
            </Button>
          </div>
        </form>
      </Modal>
    </Modal>
  );
}
export function ReportsPage() {
  const { state } = useApp();
  const [kind, setKind] = useState("stock");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [location, setLocation] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [salesman, setSalesman] = useState("");
  const [product, setProduct] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const filters = {
    from,
    to,
    locationId: location,
    warehouseId: warehouse,
    vehicleId: kind === "invoices" ? "" : vehicle,
    salesmanId: kind === "invoices" ? "" : salesman,
    productId: product,
    category,
    status,
  };
  const history = useHistory<
    Sale | Transfer | Movement | PurchaseInvoice | DailyReport
  >(
    ["stock", "reconciliation"].includes(kind) ? null : kind,
    filters,
    state.serverTime,
  );
  const [reconciliation, setReconciliation] = useState<
    {
      warehouseId: string;
      warehouseName: string;
      day: string;
      lines: (ReportLine & {
        receipts: number;
        outgoing: number;
        returns: number;
        ledgerMatchesLive: boolean;
      })[];
    }[]
  >([]);
  const [reconciliationError, setReconciliationError] = useState("");
  useEffect(() => {
    if (kind !== "reconciliation") return;
    let active = true;
    // Clear a previous request error as the reconciliation query changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReconciliationError("");
    api<typeof reconciliation>(
      `/reconciliation?day=${from || businessDay(state)}&warehouseId=${warehouse}`,
    )
      .then((r) => {
        if (active) setReconciliation(r);
      })
      .catch((e) => {
        if (active) setReconciliationError(e.message);
      });
    return () => {
      active = false;
    };
  }, [kind, from, warehouse, state]);
  const pmap = useMemo(
    () => new Map(state.products.map((p) => [p.id, p])),
    [state.products],
  );
  const vmap = useMemo(
    () => new Map(state.vehicles.map((v) => [v.id, v])),
    [state.vehicles],
  );
  const wmap = useMemo(
    () => new Map(state.warehouses.map((w) => [w.id, w])),
    [state.warehouses],
  );
  const nameMap = useMemo(
    () =>
      new Map(
        [...state.warehouses, ...state.vehicles].map((l) => [l.id, l.name]),
      ),
    [state.warehouses, state.vehicles],
  );
  const date = (d: string) =>
    d.length === 10
      ? d
      : new Intl.DateTimeFormat("en-CA", {
          timeZone: state.settings.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(d));
  const dateOk = (d: string) =>
    (!from || date(d) >= from) && (!to || date(d) <= to);
  const prodOk = (id: string) =>
    (!product || id === product) &&
    (!category || pmap.get(id)?.category === category);
  const scopeOk = (id: string) => {
    const v = vmap.get(id);
    const w = wmap.get(v?.warehouseId || id);
    return (
      (!vehicle || id === vehicle) &&
      (!warehouse || w?.id === warehouse) &&
      (!location || w?.locationId === location) &&
      (!salesman || v?.salesmanId === salesman)
    );
  };
  const options = [
    ["stock", "Godown & vehicle stock"],
    ["sales", "Sales by date / product"],
    ["transfers", "Loads & transfers"],
    ["movements", "Movement ledger"],
    ["invoices", "Purchase invoice status"],
    ["reports", "Daily report approvals"],
    ["reconciliation", "Godown reconciliation"],
  ];
  let headers: string[] = [];
  let rows: unknown[][] = [];
  let viewRows: React.ReactNode[][] = [];
  let note = "";
  if (kind === "stock") {
    headers = [
      "Product",
      "Location",
      "Type",
      "Base quantity",
      "Unit",
      "Current mixed quantity",
      "Packaging version",
    ];
    rows = state.balances
      .filter((b) => scopeOk(b.locationId) && prodOk(b.productId))
      .map((b) => {
        const p = pmap.get(b.productId);
        return [
          p?.name,
          nameMap.get(b.locationId),
          b.locationType,
          b.quantity,
          p?.packaging?.baseUnit,
          quantity(b.quantity, p),
          p?.packaging?.version,
        ];
      });
    note =
      "Live committed balances with current packaging. Date filters apply to historical reports, not this live stock view.";
  }
  if (kind === "sales") {
    headers = [
      "Date",
      "Reference",
      "Vehicle",
      "Historical salesman",
      "Product",
      "Entered quantity",
      "Unit",
      "Base quantity",
      "Snapshot mixed quantity",
      "Status",
    ];
    rows = (history.items as Sale[])
      .filter(
        (s) =>
          dateOk(s.day) &&
          (!vehicle || s.vehicleId === vehicle) &&
          (!salesman || s.salesmanId === salesman) &&
          (!warehouse ||
            (s.warehouseId || vmap.get(s.vehicleId)?.warehouseId) ===
              warehouse) &&
          (!location ||
            wmap.get(s.warehouseId || vmap.get(s.vehicleId)?.warehouseId || "")
              ?.locationId === location) &&
          (!status || s.status === status),
      )
      .flatMap((s) =>
        s.lines
          .filter((l) => prodOk(l.productId))
          .map((l) => [
            s.day,
            s.reference,
            vmap.get(s.vehicleId)?.name,
            s.salesmanName,
            l.productName,
            l.quantity,
            l.unitCode,
            l.baseQuantity,
            formatLevels(l.baseQuantity, l.levels, l.baseUnit),
            s.status,
          ]),
      );
    note =
      "Historical sale snapshots. Replaced or voided rows remain visible; use status POSTED for current net sale entries.";
  }
  if (kind === "transfers") {
    headers = [
      "Posted",
      "Reference",
      "From godown",
      "To vehicle",
      "Product",
      "Entered quantity",
      "Unit",
      "Base quantity",
      "Snapshot quantity",
    ];
    rows = (history.items as Transfer[])
      .filter((t) => dateOk(t.createdAt) && scopeOk(t.vehicleId))
      .flatMap((t) =>
        t.lines
          .filter((l) => prodOk(l.productId))
          .map((l) => [
            dateTime(t.createdAt),
            t.reference,
            wmap.get(t.warehouseId)?.name,
            vmap.get(t.vehicleId)?.name,
            l.productName,
            l.quantity,
            l.unitCode,
            l.baseQuantity,
            formatLevels(l.baseQuantity, l.levels, l.baseUnit),
          ]),
      );
    note =
      "Posted stock transfers. The same base quantity leaves the godown and enters the vehicle.";
  }
  if (kind === "movements") {
    headers = [
      "Posted",
      "Product",
      "Location",
      "Movement",
      "Base-unit change",
      "Reference",
      "Actor",
      "Note",
    ];
    rows = (history.items as Movement[])
      .filter(
        (m) =>
          dateOk(m.createdAt) && scopeOk(m.locationId) && prodOk(m.productId),
      )
      .map((m) => [
        dateTime(m.createdAt),
        pmap.get(m.productId)?.name,
        nameMap.get(m.locationId),
        m.kind,
        m.quantity,
        m.reference,
        m.actorName,
        m.note,
      ]);
    note = "Append-only signed ledger in canonical base units.";
  }
  if (kind === "invoices") {
    headers = [
      "Invoice date",
      "Supplier",
      "Invoice number",
      "Receiving godown",
      "State",
      "Extraction",
      "Revision",
      "Receipt reference",
    ];
    rows = (history.items as PurchaseInvoice[])
      .filter(
        (i) =>
          dateOk(i.createdAt) &&
          (!warehouse || i.warehouseId === warehouse) &&
          (!location || wmap.get(i.warehouseId)?.locationId === location) &&
          (!status || i.status === status) &&
          (!product || i.lines.some((l) => l.productId === product)),
      )
      .map((i) => [
        i.invoiceDate,
        i.supplier,
        i.invoiceNumber,
        wmap.get(i.warehouseId)?.name,
        i.status,
        i.extractionStatus,
        i.revision,
        i.receiptReference,
      ]);
    note =
      "Supplier dates and approval status. Filters use upload date; receipt stock posts on the actual approval date.";
  }
  if (kind === "reports") {
    headers = [
      "Business date",
      "Vehicle",
      "Salesman",
      "Revision",
      "Status",
      "Submitted",
      "Decided",
      "Reason",
    ];
    rows = (history.items as DailyReport[])
      .filter(
        (r) =>
          dateOk(r.day) &&
          (!vehicle || r.vehicleId === vehicle) &&
          (!salesman || r.salesmanId === salesman) &&
          (!status || r.status === status),
      )
      .map((r) => [
        r.day,
        r.vehicleName,
        r.salesmanName,
        r.revision,
        r.status,
        dateTime(r.submittedAt),
        dateTime(r.decidedAt),
        r.decisionReason,
      ]);
    note =
      "Latest report revision status. Open Daily Report Approvals for exact historical snapshots and approval decisions.";
  }
  if (kind === "reconciliation") {
    headers = [
      "Godown",
      "Product",
      "Opening base",
      "Receipts base",
      "Outgoing loads base",
      "Signed adjustments base",
      "Closing base",
      "Closing quantity",
    ];
    const start = from || businessDay(state);
    rows = reconciliation
      .filter(
        (r) => !location || wmap.get(r.warehouseId)?.locationId === location,
      )
      .flatMap((r) =>
        r.lines
          .filter((l) => prodOk(l.productId))
          .map((l) => [
            r.warehouseName,
            l.productName,
            l.opening,
            l.receipts,
            l.outgoing,
            l.adjustments + l.returns,
            l.closing,
            l.formatted,
          ]),
      );
    note = `Complete server ledger reconciliation for ${start}. Closing = opening + receipts − outgoing loads + returns + signed adjustments. Current packaging labels are used.`;
  }
  viewRows = rows.map((r) => r.map((v) => String(v ?? "—")));
  return (
    <>
      <div className="sd-tabs">
        {options.map(([value, label]) => (
          <button
            className={kind === value ? "active" : ""}
            key={value}
            onClick={() => {
              setKind(value);
              setStatus("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <Panel
        title={options.find((o) => o[0] === kind)?.[1]}
        subtitle="Filter the rows, then export the same view"
      >
        <div className="sd-filter-grid sd-no-print">
          <Field
            label={kind === "reconciliation" ? "Business day" : "From date"}
          >
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To date">
            <Input
              type="date"
              value={to}
              disabled={kind === "reconciliation" || kind === "stock"}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label="Business location">
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              <option value="">All locations</option>
              {state.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Godown">
            <select
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
            >
              <option value="">All godowns</option>
              {state.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vehicle">
            <select
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
            >
              <option value="">All vehicles</option>
              {state.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Salesman">
            <select
              value={salesman}
              onChange={(e) => setSalesman(e.target.value)}
            >
              <option value="">All salesmen</option>
              {state.users
                .filter((u) => u.role === "salesman")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Product">
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
            >
              <option value="">All products</option>
              {state.products.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {[...new Set(state.products.map((p) => p.category))].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          {["sales", "invoices", "reports"].includes(kind) && (
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {(kind === "sales"
                  ? ["POSTED", "CORRECTED", "VOID"]
                  : kind === "invoices"
                    ? [
                        "DRAFT",
                        "READY_FOR_APPROVAL",
                        "APPROVED_POSTED",
                        "REJECTED",
                      ]
                    : ["SUBMITTED", "APPROVED", "REJECTED", "REOPENED"]
                ).map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <div className="sd-toolbar">
          <Button
            variant="secondary"
            onClick={() => {
              setFrom("");
              setTo("");
              setLocation("");
              setWarehouse("");
              setVehicle("");
              setSalesman("");
              setProduct("");
              setCategory("");
              setStatus("");
            }}
          >
            Reset filters
          </Button>
          <a
            className="sd-btn sd-secondary"
            href={`/api/v2/export?${new URLSearchParams({ kind, day: from || businessDay(state), ...filters })}`}
          >
            <Download size={14} />
            Export all matching CSV
          </a>
          <Button
            variant="secondary"
            onClick={() =>
              downloadCsv(
                `sanket-${kind}-${businessDay(state)}.csv`,
                headers,
                rows,
              )
            }
          >
            <Download size={14} />
            Export visible rows
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={14} />
            Print / PDF
          </Button>
          <small>{rows.length} displayed product rows</small>
        </div>
        <div className="sd-notice">{note}</div>
        <ErrorNotice error={reconciliationError} />
        <DataTable
          headers={headers}
          rows={viewRows}
          empty={
            history.busy
              ? "Loading report records…"
              : "No records match these filters"
          }
        />
        {!["stock", "reconciliation"].includes(kind) && (
          <HistoryPagination {...history} />
        )}
      </Panel>
    </>
  );
}
