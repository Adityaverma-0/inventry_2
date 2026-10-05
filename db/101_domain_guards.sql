ALTER TABLE sanket.stock_documents ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES sanket.stock_documents(id);
ALTER TABLE sanket.stock_documents ADD COLUMN IF NOT EXISTS source_invoice_id uuid REFERENCES sanket.invoices(id);
CREATE INDEX IF NOT EXISTS document_invoice_corrections ON sanket.stock_documents(source_invoice_id) WHERE source_invoice_id IS NOT NULL;
CREATE OR REPLACE FUNCTION sanket.protect_posted_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Posted transaction history cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status','replaced_by_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','replaced_by_id']) THEN
    RAISE EXCEPTION 'Posted transaction quantities and conversion snapshots are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_posted_document ON sanket.stock_documents;
CREATE TRIGGER protect_posted_document BEFORE UPDATE OR DELETE ON sanket.stock_documents FOR EACH ROW EXECUTE FUNCTION sanket.protect_posted_document();
CREATE OR REPLACE FUNCTION sanket.protect_approved_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='APPROVED_POSTED' THEN RAISE EXCEPTION 'Approved invoice is immutable; post a linked correction'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_approved_invoice ON sanket.invoices;
CREATE TRIGGER protect_approved_invoice BEFORE UPDATE OR DELETE ON sanket.invoices FOR EACH ROW EXECUTE FUNCTION sanket.protect_approved_invoice();
