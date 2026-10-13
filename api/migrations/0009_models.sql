-- H5 S1 (docs/H5-MODELS.md §5, D-78 … D-93): the models a user registered and the calls made through them. Additive only.
--
-- `models` holds the user's API key encrypted (AES-GCM; key in the Worker secret MODEL_KEY_SECRET, never in D1). The
-- associated data is `user_id | id | base_url`, so a stored key decrypts for that endpoint only (D-84). The device never
-- sees the key: these rows are served by /me/models without the key columns and are not part of record sync.
CREATE TABLE models (
  user_id     TEXT    NOT NULL REFERENCES users(id),
  id          TEXT    NOT NULL,          -- device-chosen id (uuid)
  label       TEXT    NOT NULL,
  format      TEXT    NOT NULL,          -- 'openai-chat' | 'anthropic-messages' (D-81)
  base_url    TEXT    NOT NULL,          -- https, no user info, no IP literal (src/models.ts)
  model       TEXT    NOT NULL,          -- the provider's model id, as the user typed it
  max_tokens  INTEGER NOT NULL,
  key_ct      TEXT,                      -- base64 ciphertext; NULL = no key (cleared when format or base URL changes)
  key_iv      TEXT,
  key_hint    TEXT,                      -- last 4 characters, for "which key is this"
  key_version INTEGER,                   -- which MODEL_KEY_SECRET encrypted it (rotation)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- One row per model call (D-87: the audit for model calls). The prompt is held only while the call runs and cleared in
-- the same write that records the outcome; the Workflow instance carries ids only, so no prompt sits in Workflow state.
-- The reply is model output derived from the user's notes: kept until the device stores the run (PATCH) or 7 days pass.
CREATE TABLE ai_calls (
  user_id      TEXT    NOT NULL REFERENCES users(id),
  id           TEXT    NOT NULL,         -- server-generated; also the Workflow instance id
  model_id     TEXT    NOT NULL,
  stage        TEXT    NOT NULL,         -- 'harness' | 'widget' | 'test'
  run_id       TEXT,                     -- the device's run id; NULL for a model test
  entry_count  INTEGER NOT NULL,
  prompt_bytes INTEGER NOT NULL,
  prompt       TEXT,                     -- only while status is 'pending' or 'calling'
  status       TEXT    NOT NULL,         -- pending · calling · ok · cut_off · refused · key_rejected · rate_limited · model_not_found
                                         -- · model_unavailable · provider_down · bad_request · no_key · lost
  stop         TEXT,                     -- the provider's own stop reason, verbatim
  tokens_in    INTEGER,
  tokens_out   INTEGER,
  reply        TEXT,
  started_at   INTEGER NOT NULL,
  claimed_at   INTEGER,                  -- when a Workflow step claimed it ('calling'): one provider call per row
  finished_at  INTEGER,
  reply_cleared_at INTEGER,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX ai_calls_user_started ON ai_calls(user_id, started_at);
