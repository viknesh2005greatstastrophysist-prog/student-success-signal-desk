CREATE TABLE IF NOT EXISTS aura_mentor_decisions (
  decision_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  run_id TEXT,
  mentor_user_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('APPROVED', 'REJECTED')),
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aura_interventions (
  intervention_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES aura_mentor_decisions(decision_id),
  case_id TEXT NOT NULL,
  mentor_user_id TEXT NOT NULL,
  support_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  outcome TEXT NOT NULL DEFAULT 'Not recorded',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aura_followups (
  followup_id TEXT PRIMARY KEY,
  intervention_id TEXT NOT NULL REFERENCES aura_interventions(intervention_id),
  recorded_by TEXT NOT NULL,
  operational_outcome TEXT NOT NULL,
  causal_claim BOOLEAN NOT NULL DEFAULT FALSE CHECK (causal_claim = FALSE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION aura_enforce_mentor_approval()
RETURNS TRIGGER AS $$
DECLARE
  decision aura_mentor_decisions%ROWTYPE;
BEGIN
  SELECT * INTO decision FROM aura_mentor_decisions WHERE decision_id = NEW.decision_id;
  IF decision.decision_id IS NULL OR decision.outcome <> 'APPROVED' THEN
    RAISE EXCEPTION 'mentor approval is required before intervention creation';
  END IF;
  IF decision.case_id <> NEW.case_id OR decision.mentor_user_id <> NEW.mentor_user_id THEN
    RAISE EXCEPTION 'intervention does not match the approving mentor decision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS aura_intervention_mentor_gate ON aura_interventions;
CREATE TRIGGER aura_intervention_mentor_gate
BEFORE INSERT ON aura_interventions
FOR EACH ROW EXECUTE FUNCTION aura_enforce_mentor_approval();

DROP TRIGGER IF EXISTS aura_mentor_decisions_append_only ON aura_mentor_decisions;
CREATE TRIGGER aura_mentor_decisions_append_only
BEFORE UPDATE OR DELETE ON aura_mentor_decisions
FOR EACH ROW EXECUTE FUNCTION aura_reject_mutation();

DROP TRIGGER IF EXISTS aura_followups_append_only ON aura_followups;
CREATE TRIGGER aura_followups_append_only
BEFORE UPDATE OR DELETE ON aura_followups
FOR EACH ROW EXECUTE FUNCTION aura_reject_mutation();

COMMENT ON TABLE aura_mentor_decisions IS
  'Append-only human decisions. An approved row is a database prerequisite for intervention creation.';
COMMENT ON TABLE aura_followups IS
  'Append-only operational outcomes; causal claims are forbidden by constraint.';
