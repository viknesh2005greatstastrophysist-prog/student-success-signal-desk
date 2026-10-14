-- Remembered devices (additive). "Keep me signed in on this device" gives the browser
-- one random token per workspace sign-in. Only the SHA-256 of the token is stored; the
-- token itself lives in a cookie. A token is bound to one account and one workspace,
-- expires after 7 days, is replaced (rotated) each time it is used, and is revoked on
-- sign-out. It is not a password: the credential hash ties it to the password it was
-- issued under, so changing the password ends every remembered device.
CREATE TABLE IF NOT EXISTS device_tokens (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  user_id text NOT NULL,
  portal text NOT NULL,
  credential_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  rotated_at timestamptz,
  replaced_by uuid,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS device_tokens_account_idx ON device_tokens (user_id, portal) WHERE revoked_at IS NULL;
