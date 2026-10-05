"use client";
import {
  createContext,
  useContext,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { ArrowRight, Box, LoaderCircle, Search, X } from "lucide-react";
import { displayQuantity } from "./stock-preview";
import type { AppState, Product, UnitLevel } from "@/lib/domain/types";
export type PageId =
  | "overview"
  | "locations"
  | "products"
  | "packaging"
  | "invoices"
  | "inventory"
  | "team"
  | "loads"
  | "sales"
  | "daily"
  | "reports"
  | "notifications"
  | "sync"
  | "settings"
  | "warehouse-stock"
  | "returns"
  | "new-sale";
export const AppContext = createContext<{
  state: AppState;
  refresh: () => Promise<void>;
  navigate: (page: PageId) => void;
  notify: (text: string) => void;
  online: boolean;
}>({} as never);
export const useApp = () => useContext(AppContext);
export function Button({
  children,
  variant = "primary",
  busy = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`sd-btn sd-${variant} ${props.className || ""}`}
    >
      {busy && <LoaderCircle size={16} className="sd-spin" />}
      {children}
    </button>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="sd-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`sd-input ${props.className || ""}`} />;
}
export function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: string;
}) {
  const t =
    tone ||
    (String(children).match(/APPROVED|Ready|Active|Confirmed|COMPLETED/)
      ? "green"
      : String(children).match(/REJECTED|Failed|FAILED|Inactive/)
        ? "red"
        : String(children).match(
              /SUBMITTED|Pending|DRAFT|Required|QUEUED|PROCESSING/,
            )
          ? "amber"
          : "blue");
  return (
    <span className={`sd-badge ${t}`}>
      {String(children).replaceAll("_", " ")}
    </span>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`sd-panel ${className}`}>
      {(title || action) && (
        <div className="sd-panel-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Empty({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="sd-empty">
      <div className="sd-empty-icon">{icon || <Box size={25} />}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function DataTable({
  headers,
  rows,
  empty = "No records yet",
}: {
  headers: ReactNode[];
  rows: ReactNode[][];
  empty?: string;
}) {
  return rows.length ? (
    <Table className="sd-table">
      <TableHeader>
        <TableRow>
          {headers.map((h, i) => (
            <TableHead key={i}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            {r.map((c, j) => (
              <TableCell key={j}>{c}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ) : (
    <Empty title={empty} />
  );
}
export function Modal({
  title,
  description,
  open,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className={`sd sd-modal ${wide ? "sd-modal-wide" : ""}`}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {description || "Review the details before saving."}
        </DialogDescription>
        <div className="sd-modal-body">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
export function ErrorNotice({ error }: { error?: string }) {
  return error ? (
    <div className="sd-notice sd-error" role="alert">
      {error}
    </div>
  ) : null;
}
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="sd-search">
      <Search size={17} />
      <Input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange("")}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}
export function Stat({
  label,
  value,
  detail,
  icon,
  tone = "blue",
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <div className="sd-stat">
      <div className={`sd-stat-icon ${tone}`}>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="sd-text-link" onClick={onClick}>
      {children}
      <ArrowRight size={14} />
    </button>
  );
}
export function quantity(value: number, product?: Product | null) {
  return displayQuantity(value, product?.packaging || null);
}
export function formatLevels(
  value: number,
  levels: UnitLevel[],
  baseUnit: string,
) {
  return displayQuantity(value, { levels, baseUnit });
}
export function ProductName({ product }: { product?: Product }) {
  return (
    <div>
      <strong>{product?.name || "Unknown product"}</strong>
      <small className="sd-sub">
        {product?.sku || product?.category || "—"}
      </small>
    </div>
  );
}

export function HistoryPagination({
  page,
  pageSize,
  total,
  hasMore,
  setPage,
  busy,
  error,
}: {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  setPage: (n: number) => void;
  busy: boolean;
  error: string;
}) {
  return (
    <div className="sd-no-print">
      <ErrorNotice error={error} />
      <div className="sd-pagination">
        <small>
          {busy
            ? "Loading records…"
            : `${total.toLocaleString("en-IN")} records · page ${page} of ${Math.max(1, Math.ceil(total / pageSize))}`}
        </small>
        <div className="sd-row-actions">
          <Button
            variant="secondary"
            disabled={busy || page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !hasMore}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
