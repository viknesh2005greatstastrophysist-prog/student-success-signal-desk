-- Opt-in only. Never applied to the public synthetic schema by the normal migrator.
CREATE TABLE IF NOT EXISTS college_source_vault (
  package_hash text PRIMARY KEY CHECK (package_hash ~ '^[a-f0-9]{64}$'),
  dataset_hash text NOT NULL CHECK (dataset_hash ~ '^[a-f0-9]{64}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  review jsonb NOT NULL,
  access jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION reject_college_vault_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'College source versions and access evidence are immutable'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS college_vault_immutable ON college_source_vault;
CREATE TRIGGER college_vault_immutable BEFORE UPDATE OR DELETE ON college_source_vault FOR EACH ROW EXECUTE FUNCTION reject_college_vault_mutation();
CREATE TABLE IF NOT EXISTS college_normalization_vault (
  batch_hash text PRIMARY KEY CHECK (batch_hash ~ '^[a-f0-9]{64}$'),
  package_hash text NOT NULL REFERENCES college_source_vault(package_hash),
  batch jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS college_normalization_immutable ON college_normalization_vault;
CREATE TRIGGER college_normalization_immutable BEFORE UPDATE OR DELETE ON college_normalization_vault FOR EACH ROW EXECUTE FUNCTION reject_college_vault_mutation();
