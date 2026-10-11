-- S2b (DECISION-TREE D-48..D-50): after DELETE /me, the account's other devices should hear "account deleted", not a
-- generic "signed out", so they can offer an export and wipe their local copy. Only the SHA-256 of each bearer token is
-- kept — no user id, no email — and rows older than a session's life are purged on the next deletion.
-- Not an account table: nothing here identifies a person (see ACCOUNT_EXEMPT in src/account.ts).
CREATE TABLE deleted_tokens (
  token_hash TEXT    PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
