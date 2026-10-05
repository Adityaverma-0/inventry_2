import type { Product } from "../domain/types.ts";

export type SupportedMime = "application/pdf" | "image/png" | "image/jpeg";
export type StoredFile = {
  id: string;
  fileId: string;
  name: string;
  fileName: string;
  mime: SupportedMime;
  size: number;
  hash: string;
  createdAt: string;
};
export type LoadedFile = { metadata: StoredFile; bytes: Buffer };
export type Evidence = { page: number; line: number; text: string };
export type ProductMatch = {
  productId: string;
  name: string;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  unitCode: string | null;
  packagingId: string | null;
};
export type InvoiceCandidate = {
  description: string;
  productCode: string | null;
  billedQuantity: number | null;
  unit: string | null;
  freeQuantity: number | null;
  unitPrice: string | null;
  amount: string | null;
  evidence: Evidence;
  raw: Record<string, string>;
  matches: ProductMatch[];
  issues: string[];
  requiresConfirmation: true;
};
export type InvoiceExtraction = {
  extractionStatus: "COMPLETED";
  extractedText: string;
  supplier: string;
  invoiceNumber: string;
  invoiceDate: string;
  taxIdentifier: string;
  suggestions: InvoiceCandidate[];
  warnings: string[];
  pages: number;
  engines: string[];
  extractionError: "";
};
export type ExtractionUpdate = Partial<
  Omit<InvoiceExtraction, "extractionStatus" | "extractionError">
> & {
  extractionStatus: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  extractionError?: string;
};
export type ExtractionHooks = {
  products: () => Promise<Product[]>;
  update: (invoiceId: string, result: ExtractionUpdate) => Promise<void>;
};
export class DocumentError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status = 422) {
    super(message);
    this.name = "DocumentError";
    this.code = code;
    this.status = status;
  }
}
