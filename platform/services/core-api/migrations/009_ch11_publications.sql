CREATE TABLE ch11_publications (
  id uuid PRIMARY KEY, generation_id uuid NOT NULL,
  support_plan_id uuid NOT NULL REFERENCES support_plans(id),
  artifact_id uuid NOT NULL REFERENCES agent_artifacts(id),
  original_decision_id uuid NOT NULL REFERENCES faculty_decisions(id),
  version integer NOT NULL, actor_person_id uuid NOT NULL REFERENCES people(id),
  restored_from uuid REFERENCES ch11_publications(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(generation_id,support_plan_id,version)
);
CREATE TRIGGER ch11_publications_append_only BEFORE UPDATE OR DELETE ON ch11_publications
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
-- Record existing decisions as the immutable initial publication; no new approvals.
INSERT INTO ch11_publications(id,generation_id,support_plan_id,artifact_id,original_decision_id,version,actor_person_id)
SELECT p.id,p.generation_id,p.id,d.agent_artifact_id,d.id,1,d.faculty_person_id
FROM support_plans p JOIN faculty_decisions d ON d.id=p.faculty_decision_id WHERE d.decision='approved';
