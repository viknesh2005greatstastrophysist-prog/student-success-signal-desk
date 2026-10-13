ALTER TABLE ch11_policies ADD COLUMN scoring jsonb NOT NULL DEFAULT '{"attendanceWeight":20,"markWeight":20,"inactivityWeight":20,"overdueWeight":10,"internshipWeight":15,"placementWeight":15,"overdueMinimum":1,"internshipMinimum":1,"placementMinimum":1}'::jsonb;
CREATE TABLE ch11_policy_attestations (
 policy_id uuid PRIMARY KEY REFERENCES ch11_policies(id), generation_id uuid NOT NULL,
 approved_by uuid NOT NULL REFERENCES people(id), approved_role text NOT NULL CHECK(approved_role='faculty'),
 policy_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), provenance text NOT NULL DEFAULT 'direct faculty approval'
);
CREATE TRIGGER ch11_policy_attestations_append_only BEFORE UPDATE OR DELETE ON ch11_policy_attestations
FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
-- Recover actual faculty authorship from existing immutable approval events.
-- No attestation is created for an HoD delegation or an unidentified approver.
INSERT INTO ch11_policy_attestations(policy_id,generation_id,approved_by,approved_role,policy_version,created_at,provenance)
SELECT DISTINCT ON(p.id) p.id,p.generation_id,e.actor_person_id,'faculty',p.policy->>'version',e.created_at,'legacy faculty approval event with explicit historical default scoring'
FROM ch11_policies p JOIN ch11_events e ON e.subject_id=p.id AND e.generation_id=p.generation_id AND e.event_type='policy.approved'
WHERE e.actor_person_id=p.faculty_person_id AND EXISTS(SELECT 1 FROM role_assignments r WHERE r.generation_id=p.generation_id AND r.person_id=e.actor_person_id AND r.role='faculty') ORDER BY p.id,e.created_at;
