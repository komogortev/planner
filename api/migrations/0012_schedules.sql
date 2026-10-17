-- H5 S3-1 (docs/H5-S3-SCHEDULES.md, D-126, D-131, D-133): an account-level model default and its Morning schedule.
-- The model marker is distinct from each device's local run choice. Existing accounts adopt their oldest keyed model,
-- preserving the prior no-choice fallback while giving a schedule a stable account-level selection.
ALTER TABLE models ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1));
UPDATE models
SET is_default = 1
WHERE key_ct IS NOT NULL
  AND id = (
    SELECT id FROM models AS candidate
    WHERE candidate.user_id = models.user_id AND candidate.key_ct IS NOT NULL
    ORDER BY candidate.created_at, candidate.id
    LIMIT 1
  );
CREATE UNIQUE INDEX models_one_default_per_user ON models(user_id) WHERE is_default = 1;

CREATE TABLE schedules (
  user_id      TEXT    NOT NULL REFERENCES users(id),
  id           TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind = 'morning'),
  hour         INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  zone         TEXT    NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  paused_reason TEXT,
  fail_count   INTEGER NOT NULL DEFAULT 0 CHECK (fail_count >= 0),
  last_day     TEXT,
  last_call_id TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, kind)
);
CREATE INDEX schedules_due ON schedules(enabled, hour, last_day);

-- Scheduled calls compose on the Worker; the run header is returned to the device to apply on next open (D-123, D-133).
ALTER TABLE ai_calls ADD COLUMN header TEXT;
