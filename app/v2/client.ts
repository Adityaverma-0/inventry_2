"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult, AppState } from "@/lib/domain/types";
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const res = await fetch(`/api/v2${path}`, {
    method: method || (body ? "POST" : "GET"),
    credentials: "same-origin",
    headers:
      body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
    cache: "no-store",
  });
  const data: unknown = await res.json().catch(() => ({}));
  const failure = data as {
    error?: string | { message?: string };
    message?: string;
  };
  if (!res.ok)
    throw new ApiError(
      (typeof failure.error === "string"
        ? failure.error
        : failure.error?.message) ||
        failure.message ||
        "This request could not be completed. Please try again.",
      res.status,
    );
  return data as T;
}
export const requestId = () => crypto.randomUUID();
export function useMutation(onSuccess?: () => void | Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const run = useCallback(
    async (action: string, data: unknown) => {
      const fingerprint = JSON.stringify([action, data]);
      if (pending.current?.fingerprint !== fingerprint)
        pending.current = { fingerprint, id: requestId() };
      setBusy(true);
      setError("");
      try {
        const result = await api<ActionResult>("/action", {
          action,
          data,
          requestId: pending.current.id,
        });
        pending.current = null;
        await onSuccess?.();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [onSuccess],
  );
  return { run, busy, error, setError };
}
export type OutboxEntry = {
  id: string;
  userId: string;
  data: unknown;
  createdAt: string;
  state: "Pending" | "Failed" | "Confirmed" | "Cancelled";
  error: string;
  reference?: string;
};
async function outboxDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("sanket-sale-outbox-v2", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("sales", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function outboxList(userId: string): Promise<OutboxEntry[]> {
  const db = await outboxDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sales");
    const req = tx.objectStore("sales").getAll();
    req.onsuccess = () => {
      resolve(
        (req.result as OutboxEntry[])
          .filter((r) => r.userId === userId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
      db.close();
    };
    req.onerror = () => {
      reject(req.error);
      db.close();
    };
  });
}
export async function outboxPut(entry: OutboxEntry) {
  const db = await outboxDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("sales", "readwrite");
    tx.objectStore("sales").put(entry);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export function businessDay(state?: AppState) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: state?.settings.timezone || "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function activeVehicleDay(state: AppState, vehicleId: string) {
  let day = businessDay(state);
  const report = state.reports.find(r => r.vehicleId === vehicleId && r.day === day);
  if (report?.status === "SUBMITTED" || report?.status === "APPROVED") {
    const d = new Date(`${day}T12:00:00Z`);
    d.setDate(d.getDate() + 1);
    day = d.toISOString().slice(0, 10);
  }
  return day;
}
export function dateTime(value?: string | null, timeZone = "Asia/Kolkata") {
  return value
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone,
      }).format(new Date(value))
    : "—";
}
export function downloadCsv(
  name: string,
  headers: string[],
  rows: unknown[][],
) {
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  const blob = new Blob(
    [
      "\uFEFF" +
        [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8;" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export type HistoryResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};
export function useHistory<T>(
  kind: string | null,
  filters: Record<string, string> = {},
  version = "",
) {
  const signature = JSON.stringify(filters);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<HistoryResult<T>>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
    hasMore: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Reset pagination when the external server query scope changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPage(1), [kind, signature]);
  useEffect(() => {
    if (!kind) return;
    let active = true;
    // Publish the loading state while synchronizing this server query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true);
    setError("");
    const q = new URLSearchParams({
      kind,
      page: String(page),
      pageSize: "50",
      ...JSON.parse(signature),
    });
    api<HistoryResult<T>>(`/history?${q}`)
      .then((r) => {
        if (active) setResult(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [kind, signature, page, version]);
  return { ...result, page, setPage, busy, error };
}
