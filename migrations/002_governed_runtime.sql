CREATE TABLE IF NOT EXISTS aura_user_profiles (
  clerk_user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('OPERATIONS', 'MENTOR', 'LEADERSHIP', 'STUDENT', 'PARENT')),
  display_name TEXT NOT NULL,
  mentor_id TEXT,
  student_ref TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aura_role_assignments (
  assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OPERATIONS', 'MENTOR', 'LEADERSHIP', 'STUDENT', 'PARENT')),
  mentor_id TEXT,
  student_ref TEXT,
  assigned_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aura_workflow_runs (
  run_id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  pipeline_version TEXT NOT NULL,
  policy_version_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error TEXT
);

CREATE TABLE IF NOT EXISTS aura_case_lineage (
  case_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES aura_workflow_runs(run_id),
  collection_run_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  policy_version_id TEXT NOT NULL,
  model_run_id TEXT,
  artifact_version_id TEXT,
  critic_artifact_id TEXT,
  repair_artifact_id TEXT,
  replay_id TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (case_id, run_id)
);

CREATE TABLE IF NOT EXISTS aura_artifacts (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES aura_workflow_runs(run_id),
  case_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, case_id, kind, version)
);

CREATE TABLE IF NOT EXISTS aura_audit_events (
  event_seq BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  run_id TEXT,
  case_id TEXT,
  state TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aura_idempotency_keys (
  key TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  response_version BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION aura_reject_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS aura_audit_events_append_only ON aura_audit_events;
CREATE TRIGGER aura_audit_events_append_only
BEFORE UPDATE OR DELETE ON aura_audit_events
FOR EACH ROW EXECUTE FUNCTION aura_reject_mutation();

DROP TRIGGER IF EXISTS aura_artifacts_append_only ON aura_artifacts;
CREATE TRIGGER aura_artifacts_append_only
BEFORE UPDATE OR DELETE ON aura_artifacts
FOR EACH ROW EXECUTE FUNCTION aura_reject_mutation();

DROP TRIGGER IF EXISTS aura_role_assignments_append_only ON aura_role_assignments;
CREATE TRIGGER aura_role_assignments_append_only
BEFORE UPDATE OR DELETE ON aura_role_assignments
FOR EACH ROW EXECUTE FUNCTION aura_reject_mutation();

CREATE INDEX IF NOT EXISTS aura_audit_events_run_idx ON aura_audit_events (run_id, event_seq);
CREATE INDEX IF NOT EXISTS aura_audit_events_case_idx ON aura_audit_events (case_id, event_seq);
CREATE INDEX IF NOT EXISTS aura_artifacts_run_idx ON aura_artifacts (run_id, case_id);

COMMENT ON TABLE aura_user_profiles IS
  'Server-owned current application role for authenticated prototype users.';
COMMENT ON TABLE aura_role_assignments IS
  'Append-only history of role provisioning decisions.';
COMMENT ON TABLE aura_audit_events IS
  'Append-only audit ledger for the governed synthetic workflow.';
COMMENT ON TABLE aura_artifacts IS
  'Immutable evidence, prompt, model-output, critic, repair, and replay artifacts.';
