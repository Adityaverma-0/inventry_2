CREATE TABLE sanket.stock_requests (
 id uuid PRIMARY KEY,
 reference text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN ('RETURN','HOLD','ALLOCATION','ADJUSTMENT')),
 status text NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED','COMPLETED')),
 vehicle_id uuid NOT NULL REFERENCES sanket.vehicles(id),
 warehouse_id uuid NOT NULL REFERENCES sanket.warehouses(id),
 assignment_id uuid NOT NULL REFERENCES sanket.assignments(id),
 salesman_id uuid NOT NULL REFERENCES sanket.users(id),
 salesman_name text NOT NULL,
 vehicle_name text NOT NULL,
 warehouse_name text NOT NULL,
 day date NOT NULL,
 lines jsonb NOT NULL,
 vehicle_snapshot jsonb NOT NULL,
 reason text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES sanket.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid REFERENCES sanket.users(id),
 decided_name text,
 decided_at timestamptz,
 decision_reason text NOT NULL DEFAULT '',
 document_id uuid UNIQUE REFERENCES sanket.stock_documents(id),
 completion_stock jsonb
);
CREATE INDEX stock_requests_salesman_history ON sanket.stock_requests(salesman_id,created_at DESC,id);
CREATE INDEX stock_requests_pending ON sanket.stock_requests(status,created_at DESC);
CREATE FUNCTION sanket.protect_stock_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'PENDING' THEN RAISE EXCEPTION 'Completed stock requests are immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','decided_by','decided_name','decided_at','decision_reason','document_id','completion_stock']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','decided_by','decided_name','decided_at','decision_reason','document_id','completion_stock'])
 THEN RAISE EXCEPTION 'Submitted stock requests are immutable'; END IF;
 IF NEW.status NOT IN ('APPROVED','REJECTED') OR NEW.decided_by IS NULL OR NEW.decided_at IS NULL THEN RAISE EXCEPTION 'A request requires a final decision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_stock_request BEFORE UPDATE OR DELETE ON sanket.stock_requests FOR EACH ROW EXECUTE FUNCTION sanket.protect_stock_request();
CREATE TABLE sanket.sales_invoices (
 sale_id uuid PRIMARY KEY REFERENCES sanket.stock_documents(id),
 invoice_number text NOT NULL UNIQUE,
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_sales_invoice BEFORE UPDATE OR DELETE ON sanket.sales_invoices FOR EACH ROW EXECUTE FUNCTION sanket.immutable_record();
