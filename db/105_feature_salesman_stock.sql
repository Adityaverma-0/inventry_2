-- Create feature_vehicle_stock
CREATE TABLE IF NOT EXISTS sanket.feature_vehicle_stock(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    salesman_id uuid NOT NULL REFERENCES sanket.users(id),
    product_id uuid NOT NULL REFERENCES sanket.products(id),
    available_qty numeric(18,2) NOT NULL DEFAULT 0,
    held_qty numeric(18,2) NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(salesman_id, product_id)
);

-- Create feature_stock_movements
CREATE TABLE IF NOT EXISTS sanket.feature_stock_movements(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    salesman_id uuid NOT NULL REFERENCES sanket.users(id),
    product_id uuid NOT NULL REFERENCES sanket.products(id),
    type text NOT NULL, -- WAREHOUSE_TO_VEHICLE, HOLD, RELEASE_HOLD, UNLOAD
    qty numeric(18,2) NOT NULL,
    before_qty numeric(18,2) NOT NULL,
    after_qty numeric(18,2) NOT NULL,
    reference_report_id uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Create feature_daily_reports
CREATE TABLE IF NOT EXISTS sanket.feature_daily_reports(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    salesman_id uuid NOT NULL REFERENCES sanket.users(id),
    report_date date NOT NULL,
    status text NOT NULL DEFAULT 'DRAFT',
    submitted_at timestamptz,
    approved_by uuid REFERENCES sanket.users(id),
    approved_at timestamptz,
    remark text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(salesman_id, report_date)
);

-- Create feature_daily_report_items
CREATE TABLE IF NOT EXISTS sanket.feature_daily_report_items(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES sanket.feature_daily_reports(id),
    product_id uuid NOT NULL REFERENCES sanket.products(id),
    type text NOT NULL, -- HOLD, UNLOAD
    qty numeric(18,2) NOT NULL,
    reason text,
    status text NOT NULL DEFAULT 'PENDING_APPROVAL', -- PENDING_APPROVAL, APPROVED, EXECUTED, CANCELLED, REJECTED
    executed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
