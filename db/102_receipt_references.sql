-- Preserve explicit delivery identity separately from human notes. Historical
-- references remain available in the immutable stock.receive audit event.
ALTER TABLE sanket.stock_documents ADD COLUMN IF NOT EXISTS delivery_reference text;
CREATE OR REPLACE FUNCTION sanket.normalize_delivery_reference(value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(regexp_replace(btrim(COALESCE(value,'')), '[[:space:]]+', ' ', 'g'))
$$;
CREATE INDEX IF NOT EXISTS stock_delivery_reference_lookup
ON sanket.stock_documents(warehouse_id,sanket.normalize_delivery_reference(delivery_reference))
WHERE kind IN ('OPENING','MANUAL_RECEIPT') AND delivery_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_receive_audit_lookup
ON sanket.audit(entity_id) WHERE action='stock.receive';
