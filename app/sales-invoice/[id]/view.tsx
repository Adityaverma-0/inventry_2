"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { InvoiceSnapshot } from "@/lib/domain/sales-invoices";
import { api, dateTime } from "@/app/v2/client";
import "./print.css";
export default function InvoiceView({ id }: { id: string }) {
  const [invoice, setInvoice] = useState<InvoiceSnapshot | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<InvoiceSnapshot>(`/sales/${encodeURIComponent(id)}/invoice`)
      .then((r) => {
        if (active) setInvoice(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  if (error)
    return (
      <main className="sales-invoice">
        <h1>Invoice unavailable</h1>
        <p role="alert">{error}</p>
        <Link href="/#sales">Back to sales</Link>
        <p>
          If the sale was confirmed, this display error has not reversed it.
          Open the sale again to retry printing.
        </p>
      </main>
    );
  if (!invoice)
    return (
      <main className="sales-invoice" role="status">
        Loading saved invoice…
      </main>
    );
  return (
    <main className="sales-invoice">
      <div className="print-actions">
        <Link href="/#sales">Back to sales</Link>
        <button onClick={() => window.print()}>Print / Save PDF</button>
      </div>
      <header>
        <div>
          <h1>{invoice.business.name}</h1>
          <p>{invoice.business.address}</p>
          <p>{invoice.business.phone}</p>
        </div>
        <h2>Sales invoice</h2>
      </header>
      {invoice.status !== "POSTED" && (
        <p className="invoice-warning">
          This sale is {invoice.status?.toLowerCase()}.{" "}
          {invoice.replacedById && (
            <a href={`/sales-invoice/${invoice.replacedById}`}>
              View replacement
            </a>
          )}
        </p>
      )}
      <section className="invoice-meta">
        <div>
          <strong>Invoice number</strong>
          <p>{invoice.invoiceNumber}</p>
          <strong>Date</strong>
          <p>{dateTime(invoice.createdAt)}</p>
          <strong>Sale reference</strong>
          <p>{invoice.reference}</p>
          <small>Sale ID: {invoice.saleId}</small>
        </div>
        <div>
          <strong>Customer</strong>
          <p>{invoice.customer.name || "Not recorded"}</p>
          <p>{invoice.customer.phone}</p>
          <p>{invoice.customer.address}</p>
          {invoice.customer.gstin && <p>GSTIN: {invoice.customer.gstin}</p>}
          <strong>Salesman</strong>
          <p>{invoice.salesmanName}</p>
          <small>{invoice.salesmanId}</small>
          <p>
            {invoice.warehouseName} · {invoice.vehicleName}
          </p>
        </div>
      </section>
      {invoice.historical && (
        <p className="invoice-warning">
          Legacy sale: original quantities are preserved. Historical prices and
          customer details were not recorded. The business header reflects
          current settings.
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Quantity</th>
            <th>Price basis</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.productName}</td>
              <td>
                {l.quantity} {l.unitCode}
                <small>
                  {l.baseQuantity} {l.baseUnit}
                </small>
              </td>
              <td>
                {l.price === null
                  ? "Not recorded"
                  : `${l.currency} ${l.price} / ${l.priceUnit}`}
              </td>
              <td>
                {l.total === null ? "Not recorded" : `${l.currency} ${l.total}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="invoice-summary">
        <h3>
          {invoice.completePricing
            ? "Recorded line total"
            : "Total of priced lines"}
        </h3>
        {invoice.totals.map((t) => (
          <p key={t.currency}>
            <strong>
              {t.currency} {t.amount}
            </strong>
          </p>
        ))}
        {invoice.subtotal && (
          <p>
            <strong>Subtotal: </strong> {invoice.totals[0]?.currency || "INR"} {invoice.subtotal}
          </p>
        )}
        {invoice.tax && (
          <p>
            <strong>Tax: </strong> {invoice.totals[0]?.currency || "INR"} {invoice.tax}
          </p>
        )}
        {invoice.discount && (
          <p>
            <strong>Discount: </strong> {invoice.totals[0]?.currency || "INR"} {invoice.discount}
          </p>
        )}
        {invoice.grandTotal && (
          <p>
            <strong>Grand Total: </strong> {invoice.totals[0]?.currency || "INR"} {invoice.grandTotal}
          </p>
        )}
        {invoice.payments && invoice.payments.length > 0 && (
          <section className="invoice-payments">
            <h3 style={{marginTop: 15}}>Payments</h3>
             {invoice.payments.map((p, i) => (
                <p key={i}>
                    <strong>{p.method}: </strong> {invoice.totals[0]?.currency || "INR"} {p.amount} {p.reference && `(${p.reference})`}
                </p>
             ))}
          </section>
        )}
        {!invoice.completePricing && (
          <p>
            A full invoice total is unavailable because one or more prices were
            not recorded.
          </p>
        )}
        <p>
          Line amounts use the recorded price unit and are rounded to two
          decimal places.
        </p>
      </section>
      <footer>
        <p>Thank you for your business.</p>
        <small>
          Reprinting this invoice does not create another sale or change
          inventory.
        </small>
      </footer>
    </main>
  );
}
