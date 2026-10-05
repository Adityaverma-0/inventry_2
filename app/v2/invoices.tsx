"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  InvoiceLine,
  Packaging,
  PurchaseInvoice,
} from "@/lib/domain/types";
import type { InvoiceCandidate } from "@/lib/documents/types";
import { api, dateTime, requestId, useMutation, useHistory } from "./client";
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
  SearchInput,
  useApp,
} from "./ui";
export function InvoicesPage() {
  const { state, refresh, notify, online } = useApp();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [upload, setUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadKey, setUploadKey] = useState(requestId);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const history = useHistory<PurchaseInvoice>(
    "invoices",
    { status, search },
    state.serverTime,
  );
  const invoice =
    state.invoices.find((i) => i.id === selected) ||
    history.items.find((i) => i.id === selected);
  useEffect(() => {
    if (
      !state.invoices.some(
        (i) =>
          i.extractionStatus === "QUEUED" ||
          i.extractionStatus === "PROCESSING",
      )
    )
      return;
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [state.invoices, refresh]);
  return (
    <>
      <div className="sd-toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search supplier, invoice or file…"
        />
        <select
          aria-label="Invoice status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All invoice states</option>
          {["DRAFT", "READY_FOR_APPROVAL", "APPROVED_POSTED", "REJECTED"].map(
            (s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ),
          )}
        </select>
        <Button onClick={() => setUpload(true)}>
          <Upload size={15} />
          Upload invoice
        </Button>
      </div>
      <Panel
        title="Purchase invoices"
        subtitle="Only “Approve & add stock” posts a warehouse receipt."
      >
        <DataTable
          headers={[
            "Invoice / file",
            "Supplier",
            "Destination",
            "Extraction",
            "Approval state",
            "Action",
          ]}
          rows={history.items.map((i) => [
            // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
            <div>
              <strong>{i.invoiceNumber || i.fileName}</strong>
              <small className="sd-sub">
                {i.invoiceDate || dateTime(i.createdAt)} · revision {i.revision}
              </small>
            </div>,
            i.supplier || "Needs review",
            state.warehouses.find((w) => w.id === i.warehouseId)?.name ||
              "Not selected",
            // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
            <Badge>{i.extractionStatus}</Badge>,
            // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
            <Badge>{i.status}</Badge>,
            // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
            <Button variant="secondary" onClick={() => setSelected(i.id)}>
              {i.status === "APPROVED_POSTED"
                ? "View receipt"
                : "Review invoice"}
            </Button>,
          ])}
          empty={
            search || status
              ? "No invoices match these filters"
              : "No supplier invoices yet"
          }
        />
        <HistoryPagination {...history} />
        {!state.invoices.length && (
          <p className="sd-legend" style={{ textAlign: "center" }}>
            Upload a PDF or invoice image. Extraction creates review suggestions
            and does not affect your stock.
          </p>
        )}
      </Panel>
      <Modal
        open={upload}
        onClose={() => setUpload(false)}
        title="Upload purchase invoice"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              const body = new FormData();
              body.set("file", file);
              body.set("requestId", uploadKey);
              const result = await api<{ id: string }>("/invoices", body);
              await refresh();
              setUpload(false);
              setSelected(result.id);
              setFile(null);
              setUploadKey(requestId());
              notify(
                "Invoice uploaded. Extraction will appear as review suggestions.",
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : "Upload failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="sd-file-drop">
            <FileText size={30} />
            <h3>Choose the original supplier document</h3>
            <p>PDF, PNG or JPEG. The original is kept privately for review.</p>
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              aria-label="Supplier invoice document"
              required
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setUploadKey(requestId());
              }}
            />
          </div>
          <div className="sd-notice">
            Scanned documents use configured OCR. You can review or enter lines
            manually if extraction is incomplete.
          </div>
          <ErrorNotice error={error} />
          <div className="sd-form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setUpload(false)}
            >
              Cancel
            </Button>
            <Button disabled={!online || !file} busy={busy}>
              Upload & extract
            </Button>
          </div>
        </form>
      </Modal>
      {invoice && (
        <InvoiceReview
          key={`${invoice.id}-${invoice.revision}`}
          invoice={invoice}
          onClose={() => setSelected("")}
        />
      )}
    </>
  );
}
function InvoiceReview({
  invoice,
  onClose,
}: {
  invoice: PurchaseInvoice;
  onClose: () => void;
}) {
  const { state, refresh, notify, online, navigate } = useApp();
  const posted = invoice.status === "APPROVED_POSTED";
  const [supplier, setSupplier] = useState(invoice.supplier);
  const [number, setNumber] = useState(invoice.invoiceNumber);
  const [day, setDay] = useState(invoice.invoiceDate);
  const [warehouseId, setWarehouse] = useState(
    invoice.warehouseId || state.warehouses[0]?.id || "",
  );
  const [lines, setLines] = useState<InvoiceLine[]>(invoice.lines);
  const [tab, setTab] = useState("details");
  const [versions, setVersions] = useState<Record<string, Packaging[]>>({});
  const [fetchError, setFetchError] = useState("");
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const mutation = useMutation(refresh);
  const [extracting, setExtracting] = useState(false);
  const products = useMemo(
    () => new Map(state.products.map((p) => [p.id, p])),
    [state.products],
  );
  const dirty =
    JSON.stringify([supplier, number, day, warehouseId, lines]) !==
    JSON.stringify([
      invoice.supplier,
      invoice.invoiceNumber,
      invoice.invoiceDate,
      invoice.warehouseId || state.warehouses[0]?.id || "",
      invoice.lines,
    ]);
  useEffect(() => {
    const ids = [...new Set(lines.map((l) => l.productId).filter(Boolean))];
    for (const id of ids) {
      if (versions[id]) continue;
      api<Packaging[] | { versions: Packaging[] }>(`/products/${id}/packaging`)
        .then((v) =>
          setVersions((old) => ({
            ...old,
            [id]: Array.isArray(v) ? v : v.versions,
          })),
        )
        .catch((e) => setFetchError(e.message));
    }
  }, [lines, versions]);
  function packaging(line: InvoiceLine) {
    return (
      versions[line.productId]?.find((p) => p.id === line.packagingId) ||
      products.get(line.productId)?.packaging
    );
  }
  function patch(i: number, data: Partial<InvoiceLine>) {
    setLines((a) => a.map((l, j) => (i === j ? { ...l, ...data } : l)));
  }
  function add(candidate?: InvoiceCandidate) {
    setLines((a) => [
      ...a,
      {
        description: candidate?.description || "",
        productId: "",
        packagingId: "",
        unitCode: "",
        invoiceQuantity: candidate?.billedQuantity ?? 0,
        receivedQuantity: candidate?.billedQuantity ?? 0,
        freeQuantity: candidate?.freeQuantity ?? 0,
        reason: "",
        evidence: candidate
          ? `Page ${candidate.evidence.page}, line ${candidate.evidence.line}: ${candidate.evidence.text}`
          : "",
      },
    ]);
  }
  const [audit, setAudit] = useState<{
    revisions: {
      revision: number;
      snapshot: Record<string, unknown>;
      actorName: string;
      createdAt: string;
    }[];
    decisions: {
      action: string;
      actorName: string;
      createdAt: string;
      detail: string;
    }[];
    corrections: {
      reference: string;
      actorName: string;
      createdAt: string;
      reason: string;
    }[];
  } | null>(null);
  useEffect(() => {
    api<typeof audit>(`/invoices/${invoice.id}/history`)
      .then(setAudit)
      .catch((e) => setFetchError(e.message));
  }, [invoice.id, invoice.revision, invoice.status]);
  const extracted = invoice.extractionMeta || {};
  const suggestions = (invoice.suggestions || []) as InvoiceCandidate[];
  const effects = lines.map((l) => {
    const p = products.get(l.productId);
    const pack = packaging(l);
    const n =
      (l.receivedQuantity + (l.freeQuantity || 0)) *
      (pack?.levels.find((u) => u.code === l.unitCode)?.factor || 0);
    return { line: l, product: p, pack, n };
  });
  const aggregated = new Map<string, number>();
  effects.forEach((e) =>
    aggregated.set(
      e.line.productId,
      (aggregated.get(e.line.productId) || 0) + e.n,
    ),
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={
        posted
          ? `Posted receipt · ${invoice.receiptReference}`
          : `Review invoice · revision ${invoice.revision}`
      }
      description={`${invoice.fileName} · ${dateTime(invoice.createdAt)}`}
      wide
    >
      <div className="sd-inline" style={{ marginBottom: 14 }}>
        <Badge>{invoice.status}</Badge>
        <Badge>{invoice.extractionStatus}</Badge>
        {posted && (
          <small>
            Approved {dateTime(invoice.approvedAt)} · {invoice.approvedBy}
          </small>
        )}
      </div>
      <div className="sd-tabs sd-review-tabs">
        <button
          className={tab === "details" ? "active" : ""}
          onClick={() => setTab("details")}
        >
          Invoice details
        </button>
        <button
          className={tab === "document" ? "active" : ""}
          onClick={() => setTab("document")}
        >
          Original document
        </button>
      </div>
      <div className="sd-review-split">
        <section className={tab === "details" ? "mobile-hidden" : ""}>
          <InvoiceDocumentPreview
            key={invoice.fileId}
            fileId={invoice.fileId}
            fileName={invoice.fileName}
          />
          <div className="sd-toolbar" style={{ marginTop: 10 }}>
            <a
              className="sd-btn sd-secondary"
              href={`/api/v2/files/${invoice.fileId}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} />
              Open original
            </a>
            <a
              className="sd-btn sd-secondary"
              href={`/api/v2/files/${invoice.fileId}?download=true`}
            >
              <Download size={14} />
              Download original
            </a>
            {!posted && (
              <Button
                variant="ghost"
                busy={extracting}
                disabled={!online}
                onClick={async () => {
                  setExtracting(true);
                  setFetchError("");
                  try {
                    await api(`/invoices/${invoice.id}/extract`, {});
                    await refresh();
                    notify("Extraction queued. Stock is unchanged.");
                  } catch (e) {
                    setFetchError(
                      e instanceof Error ? e.message : "Extraction failed",
                    );
                  } finally {
                    setExtracting(false);
                  }
                }}
              >
                <RefreshCw size={14} />
                Retry extraction
              </Button>
            )}
          </div>
          <details open={invoice.extractionStatus === "FAILED"}>
            <summary className="sd-text-link">Raw extracted text</summary>
            <pre className="sd-extracted">
              {invoice.extractedText ||
                "No extracted text yet. You can enter reviewed lines manually."}
            </pre>
          </details>
          {invoice.extractionError && (
            <div className="sd-notice sd-warning">
              Extraction: {invoice.extractionError}
            </div>
          )}
          {invoice.extractionWarnings?.map((w, i) => (
            <div className="sd-notice sd-warning" key={i}>
              {w}
            </div>
          ))}
        </section>
        <section className={tab === "document" ? "mobile-hidden" : ""}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await mutation.run("invoice.update", {
                  id: invoice.id,
                  revision: invoice.revision,
                  supplier,
                  invoiceNumber: number,
                  invoiceDate: day,
                  warehouseId,
                  lines,
                  reason: "Owner reviewed invoice lines",
                });
                notify("Review saved as a new draft revision.");
              } catch {}
            }}
          >
            {!posted &&
              !!(
                extracted.supplier ||
                extracted.invoiceNumber ||
                extracted.invoiceDate
              ) && (
                <div className="sd-notice">
                  <strong>Extracted header suggestions</strong>
                  <p>
                    {String(extracted.supplier || "Supplier not found")} ·{" "}
                    {String(extracted.invoiceNumber || "Number not found")} ·{" "}
                    {String(extracted.invoiceDate || "Date not found")}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      if (typeof extracted.supplier === "string")
                        setSupplier(extracted.supplier);
                      if (typeof extracted.invoiceNumber === "string")
                        setNumber(extracted.invoiceNumber);
                      if (typeof extracted.invoiceDate === "string")
                        setDay(extracted.invoiceDate);
                    }}
                  >
                    Apply suggested header for review
                  </Button>
                </div>
              )}
            <fieldset disabled={posted || mutation.busy}>
              <div className="sd-form">
                <Field label="Supplier">
                  <Input
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Invoice number">
                  <Input
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Supplier invoice date">
                  <Input
                    type="date"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Receiving godown">
                  <select
                    value={warehouseId}
                    onChange={(e) => setWarehouse(e.target.value)}
                    required
                  >
                    {state.warehouses
                      .filter((w) => w.active)
                      .map((w) => (
                        <option value={w.id} key={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              {!posted && suggestions.length > 0 && (
                <details style={{ marginTop: 17 }}>
                  <summary className="sd-text-link">
                    {suggestions.length} extraction suggestions to review
                  </summary>
                  {suggestions.map((s, i) => (
                    <div className="sd-invoice-line" key={i}>
                      <h3>{s.description}</h3>
                      <p className="sd-legend">
                        Extracted: {s.billedQuantity ?? "Unknown quantity"}{" "}
                        {s.unit || "unit unknown"} · free{" "}
                        {s.freeQuantity ?? "not stated"}
                      </p>
                      <p className="sd-legend">
                        {s.matches
                          ?.map((m) => `${m.name} (${m.confidence} match)`)
                          .join(" · ") || "No confident catalogue match"}
                      </p>
                      <small>{s.evidence?.text}</small>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => add(s)}
                      >
                        Add for manual matching
                      </Button>
                    </div>
                  ))}
                </details>
              )}
              {lines.map((line, i) => {
                const p = products.get(line.productId);
                const pack = packaging(line);
                return (
                  <div className="sd-invoice-line" key={i}>
                    <div className="sd-panel-head">
                      <h3>Line {i + 1}</h3>
                      {!posted && (
                        <button
                          type="button"
                          aria-label={`Remove invoice line ${i + 1}`}
                          className="sd-icon-button"
                          onClick={() =>
                            setLines((a) => a.filter((_, j) => i !== j))
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                    <div className="sd-form">
                      <Field label="Invoice description">
                        <Input
                          value={line.description}
                          onChange={(e) =>
                            patch(i, { description: e.target.value })
                          }
                          required
                        />
                      </Field>
                      <Field label="Confirmed catalogue match">
                        <select
                          value={line.productId}
                          required
                          onChange={(e) => {
                            const p = products.get(e.target.value);
                            patch(i, {
                              productId: e.target.value,
                              packagingId: p?.packaging?.id || "",
                              unitCode: p?.packaging?.baseUnit || "",
                            });
                          }}
                        >
                          <option value="">
                            Select product after verification
                          </option>
                          {state.products
                            .filter((p) => p.active && p.ready)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Product packaging version">
                        <select
                          value={line.packagingId}
                          required
                          onChange={(e) =>
                            patch(i, {
                              packagingId: e.target.value,
                              unitCode: p?.packaging?.baseUnit || "",
                            })
                          }
                        >
                          <option value="">Choose version</option>
                          {(
                            versions[line.productId] ||
                            ([p?.packaging].filter(Boolean) as Packaging[])
                          ).map((v) => (
                            <option key={v.id} value={v.id}>
                              v{v.version} ·{" "}
                              {v.levels
                                .map((l) => `${l.label}=${l.factor}`)
                                .join(", ")}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Mapped invoice unit">
                        <select
                          value={line.unitCode}
                          required
                          onChange={(e) =>
                            patch(i, { unitCode: e.target.value })
                          }
                        >
                          <option value="">Choose unit</option>
                          {pack?.levels.map((l) => (
                            <option value={l.code} key={l.code}>
                              {l.label} · {l.factor} base units
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Invoiced quantity">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={line.invoiceQuantity}
                          onChange={(e) =>
                            patch(i, {
                              invoiceQuantity: Number(e.target.value),
                            })
                          }
                          required
                        />
                      </Field>
                      <Field label="Physically received quantity">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={line.receivedQuantity}
                          onChange={(e) =>
                            patch(i, {
                              receivedQuantity: Number(e.target.value),
                            })
                          }
                          required
                        />
                      </Field>
                      <Field
                        label="Explicit free quantity"
                        hint="Only goods explicitly stated and physically received."
                      >
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={line.freeQuantity || 0}
                          onChange={(e) =>
                            patch(i, { freeQuantity: Number(e.target.value) })
                          }
                        />
                      </Field>
                      <Field label="Difference / historical pack reason">
                        <Input
                          value={line.reason}
                          onChange={(e) => patch(i, { reason: e.target.value })}
                          required={
                            line.receivedQuantity !== line.invoiceQuantity ||
                            !!line.freeQuantity ||
                            line.packagingId !== p?.packaging?.id
                          }
                        />
                      </Field>
                      <div className="sd-full">
                        <Field label="Source evidence (page / line)">
                          <Input
                            value={line.evidence}
                            onChange={(e) =>
                              patch(i, { evidence: e.target.value })
                            }
                          />
                        </Field>
                      </div>
                    </div>
                    <p
                      className="sd-line-summary"
                      style={{ margin: "13px 0 0" }}
                    >
                      Received equivalent: {effects[i].n}{" "}
                      {pack?.baseUnit || "base units"}{" "}
                      {pack
                        ? `· ${formatLevels(effects[i].n, pack.levels, pack.baseUnit)}`
                        : ""}
                    </p>
                  </div>
                );
              })}
              {!posted && (
                <Button type="button" variant="secondary" onClick={() => add()}>
                  <Plus size={14} />
                  Add reviewed line
                </Button>
              )}
            </fieldset>
            {!posted && (
              <div className="sd-form-actions">
                <Button busy={mutation.busy} disabled={!online || !dirty}>
                  Save reviewed draft
                </Button>
              </div>
            )}
          </form>
          <ErrorNotice error={fetchError || mutation.error} />
          {invoice.decisionReason && (
            <div className="sd-notice sd-warning">
              Decision note: {invoice.decisionReason}
            </div>
          )}
          <div className="sd-form-actions sd-no-print">
            {!posted && (
              <>
                <Button
                  variant="danger"
                  disabled={!online || dirty}
                  onClick={() => setDecision("reject")}
                >
                  Reject invoice
                </Button>
                {invoice.status === "READY_FOR_APPROVAL" ? (
                  <Button
                    disabled={!online || dirty}
                    onClick={() => setDecision("approve")}
                  >
                    Approve & add stock
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    busy={mutation.busy}
                    disabled={!online || dirty || !invoice.lines.length}
                    onClick={async () => {
                      try {
                        await mutation.run("invoice.ready", {
                          id: invoice.id,
                          revision: invoice.revision,
                        });
                        notify("Invoice ready for explicit approval.");
                      } catch {}
                    }}
                  >
                    Mark ready for approval
                  </Button>
                )}
              </>
            )}
            {posted && (
              <Button
                variant="secondary"
                onClick={() => {
                  onClose();
                  navigate("inventory");
                }}
              >
                Open inventory adjustments
              </Button>
            )}
          </div>
          {dirty && (
            <p className="sd-legend">
              Save your changes before marking ready or making a decision.
            </p>
          )}
        </section>
      </div>
      {audit && (
        <details style={{ marginTop: 24 }}>
          <summary className="sd-text-link">
            Saved revisions, decisions & receipt corrections
          </summary>
          <DataTable
            headers={["Revision", "Saved by", "When", "Original snapshot"]}
            rows={audit.revisions.map((r) => [
              r.revision,
              r.actorName,
              dateTime(r.createdAt),
              // eslint-disable-next-line react/jsx-key -- DataTable supplies the keyed wrapper for this cell.
              <details>
                <summary className="sd-text-link">
                  View original details
                </summary>
                <pre className="sd-extracted">
                  {JSON.stringify(r.snapshot, null, 2)}
                </pre>
              </details>,
            ])}
          />
          <DataTable
            headers={["Decision", "By", "When"]}
            rows={audit.decisions.map((d) => [
              d.action.replace("invoice.", ""),
              d.actorName,
              dateTime(d.createdAt),
            ])}
          />
          <DataTable
            headers={["Correction reference", "By", "When", "Reason"]}
            rows={audit.corrections.map((c) => [
              c.reference,
              c.actorName,
              dateTime(c.createdAt),
              c.reason,
            ])}
            empty="No linked receipt corrections"
          />
        </details>
      )}
      <Modal
        open={!!decision}
        onClose={() => setDecision(null)}
        title={
          decision === "approve"
            ? "Approve receipt & add warehouse stock"
            : "Reject this invoice"
        }
        description={`Invoice ${invoice.invoiceNumber} · revision ${invoice.revision}`}
        wide
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              const r = await mutation.run(`invoice.${decision}`, {
                id: invoice.id,
                revision: invoice.revision,
                reason: f.get("reason") || "",
              });
              notify(r.message);
              setDecision(null);
            } catch {}
          }}
        >
          {decision === "approve" ? (
            <>
              <div className="sd-notice">
                Receiving into{" "}
                <strong>
                  {
                    state.warehouses.find((w) => w.id === invoice.warehouseId)
                      ?.name
                  }
                </strong>
                . All reviewed lines post together.
              </div>
              <DataTable
                headers={[
                  "Product",
                  "Received base units",
                  "Normalized quantity",
                  "Projected godown balance",
                ]}
                rows={[...aggregated].map(([id, n]) => {
                  const p = products.get(id);
                  return [
                    p?.name,
                    n,
                    quantity(n, p),
                    quantity(
                      (state.balances.find(
                        (b) =>
                          b.locationId === invoice.warehouseId &&
                          b.productId === id,
                      )?.quantity || 0) + n,
                      p,
                    ),
                  ];
                })}
              />
              <label className="sd-check" style={{ margin: "20px 0" }}>
                <input required type="checkbox" />I verified the original
                document, receiving godown, unit versions and physical
                quantities.
              </label>
            </>
          ) : (
            <div className="sd-notice">
              Rejecting the invoice creates no stock movement. You can correct
              it in a new draft revision.
            </div>
          )}
          <Field
            label={
              decision === "reject"
                ? "Required rejection reason"
                : "Approval note (optional)"
            }
          >
            <textarea name="reason" required={decision === "reject"} rows={3} />
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
              variant={decision === "reject" ? "danger" : "primary"}
              busy={mutation.busy}
            >
              {decision === "approve"
                ? "Approve & add stock"
                : "Confirm rejection"}
            </Button>
          </div>
        </form>
      </Modal>
    </Modal>
  );
}

/** Render authenticated document pages directly; native PDF viewers vary by browser. */
function InvoiceDocumentPreview({
  fileId,
  fileName,
}: {
  fileId: string;
  fileName: string;
}) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [metadata, setMetadata] = useState<{
    pages: number;
    mime: string;
    fileName: string;
  } | null>(null);
  const [metadataError, setMetadataError] = useState("");
  const [loadedPage, setLoadedPage] = useState("");
  const [failedPage, setFailedPage] = useState("");
  const pageKey = `${page}-${attempt}`;
  const pageUrl = `/api/v2/files/${fileId}/preview?page=${page}&attempt=${attempt}`;
  const failed = failedPage === pageKey;
  const loading = !failed && loadedPage !== pageKey;
  useEffect(() => {
    let active = true;
    api<{ pages: number; mime: string; fileName: string }>(
      `/files/${fileId}/preview?metadata=true`,
    )
      .then((result) => {
        if (active) {
          setMetadata(result);
          setMetadataError("");
        }
      })
      .catch((error) => {
        if (active)
          setMetadataError(
            error instanceof Error
              ? error.message
              : "Document page information could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [fileId, attempt]);
  return (
    <div className="sd-document-preview">
      <div
        className="sd-document-pagination"
        aria-label="Invoice page navigation"
      >
        <Button
          type="button"
          variant="secondary"
          aria-label="Previous invoice page"
          disabled={page <= 1}
          onClick={() => setPage((value) => value - 1)}
        >
          <ChevronLeft size={17} />
        </Button>
        {metadata ? (
          <label className="sd-document-page-picker">
            <span>Page</span>
            <select
              aria-label="Invoice page"
              value={page}
              onChange={(event) => setPage(Number(event.target.value))}
            >
              {Array.from({ length: metadata.pages }, (_, index) => (
                <option value={index + 1} key={index + 1}>
                  {index + 1}
                </option>
              ))}
            </select>
            <span>of {metadata.pages}</span>
          </label>
        ) : (
          <span className="sd-legend">Page {page}</span>
        )}
        <Button
          type="button"
          variant="secondary"
          aria-label="Next invoice page"
          disabled={!metadata || page >= metadata.pages}
          onClick={() => setPage((value) => value + 1)}
        >
          <ChevronRight size={17} />
        </Button>
      </div>
      <div
        className="sd-document-viewport"
        tabIndex={0}
        role="region"
        aria-label={`Invoice document page ${page}. Use left and right arrow keys to navigate pages.`}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowLeft" && page > 1) {
            event.preventDefault();
            setPage((value) => value - 1);
          }
          if (event.key === "ArrowRight" && metadata && page < metadata.pages) {
            event.preventDefault();
            setPage((value) => value + 1);
          }
        }}
      >
        {loading && (
          <div className="sd-document-loading" role="status">
            <LoaderCircle size={22} className="sd-spin" />
            <span>Loading invoice page {page}…</span>
          </div>
        )}
        {!failed && (
          <>
            {/* The source is private and requires the signed-in browser cookie; image optimization must not proxy it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={pageKey}
              className="sd-document-image"
              src={pageUrl}
              alt={`Original invoice ${fileName}, page ${page}${metadata ? ` of ${metadata.pages}` : ""}`}
              style={loading ? { visibility: "hidden" } : undefined}
              onLoad={() => setLoadedPage(pageKey)}
              onError={() => setFailedPage(pageKey)}
            />
          </>
        )}
        {failed && (
          <div className="sd-document-fallback" role="alert">
            <FileText size={28} />
            <h3>This page could not be previewed</h3>
            <p>
              Your original document remains available. Download it to verify
              the invoice, or retry the preview.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RefreshCw size={14} />
              Retry preview
            </Button>
            <a
              className="sd-btn sd-secondary"
              href={`/api/v2/files/${fileId}?download=true`}
            >
              <Download size={14} />
              Download original
            </a>
          </div>
        )}
      </div>
      <div className="sd-document-caption">
        <span className="sd-legend" aria-live="polite">
          {!loading && !failed
            ? `Showing page ${page}${metadata ? ` of ${metadata.pages}` : ""}`
            : "Original document preview"}
        </span>
        {!failed && (
          <a
            className="sd-text-link"
            href={`/api/v2/files/${fileId}/preview?page=${page}`}
            target="_blank"
            rel="noreferrer"
          >
            Open page full size
            <ExternalLink size={12} />
          </a>
        )}
      </div>
      {metadataError && (
        <div className="sd-notice sd-warning">
          <p>Page navigation could not be loaded: {metadataError}</p>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry page information
          </Button>
        </div>
      )}
    </div>
  );
}
