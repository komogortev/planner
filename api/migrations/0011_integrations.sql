-- GitHub bridge G1 (docs/GITHUB-BRIDGE.md §4, D-121): outside accounts a user connects by pasting a token. Additive only.
--
-- One row per account and provider (GitHub first). The token is held encrypted exactly as model keys are (AES-GCM with the
-- Worker secret MODEL_KEY_SECRET, never in D1), with associated data `user_id | integration:<provider> | <api origin>`, so
-- a ciphertext moved to another row, account or table no longer decrypts. Served by /me/integrations without the key
-- columns; not part of record sync.
CREATE TABLE integrations (
  user_id     TEXT    NOT NULL REFERENCES users(id),
  provider    TEXT    NOT NULL,          -- 'github'
  key_ct      TEXT    NOT NULL,          -- base64 ciphertext of the token
  key_iv      TEXT    NOT NULL,
  key_hint    TEXT    NOT NULL,          -- last 4 characters, for "which token is this"
  key_version INTEGER NOT NULL,          -- which MODEL_KEY_SECRET encrypted it (rotation)
  login       TEXT    NOT NULL,          -- the account the provider says the token belongs to
  expires_at  INTEGER,                   -- epoch ms from the provider's expiry header; NULL = no expiry, or not stated
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);
