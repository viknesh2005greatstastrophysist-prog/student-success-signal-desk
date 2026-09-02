ALTER TABLE replay_receipts
ADD COLUMN command_id uuid;

UPDATE replay_receipts SET command_id = id WHERE command_id IS NULL;

ALTER TABLE replay_receipts
ALTER COLUMN command_id SET NOT NULL;

CREATE UNIQUE INDEX replay_receipts_command_idx
ON replay_receipts (generation_id, command_id);
