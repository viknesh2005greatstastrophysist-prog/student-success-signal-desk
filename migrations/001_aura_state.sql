CREATE TABLE IF NOT EXISTS aura_state (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  state JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE aura_state IS
  'Versioned shared state for the synthetic AURA student-success demonstration.';
