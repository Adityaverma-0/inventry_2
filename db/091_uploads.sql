CREATE TABLE IF NOT EXISTS sanket.upload_requests (
  request_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES sanket.users(id),
  payload_hash text NOT NULL,
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
