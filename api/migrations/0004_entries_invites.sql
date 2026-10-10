-- H1-S2 (H1-ENTRIES.md §5.2): entries + revisions, invites, a per-user change counter, account revocation.
-- Times the server stamps are epoch ms (as in 0002); times the device writes stay its ISO strings.

-- Every entry write takes the next value; it orders changes for pull (§6.2) and decides staleness (§6.3).
ALTER TABLE users ADD COLUMN version_seq INTEGER NOT NULL DEFAULT 0;
-- Set by revoking an invite: sign-in and every session check refuse the account; its data stays.
ALTER TABLE users ADD COLUMN disabled_at INTEGER;

-- An invite is bound to an email the provider must verify; the first sign-in with it creates the account. No code to
-- hand around: the provider's verification is the proof. One row per email; re-inviting replaces it.
CREATE TABLE invites (
  email      TEXT    PRIMARY KEY,           -- lowercased
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by    TEXT    REFERENCES users(id),  -- set on the sign-in that consumed it
  used_at    INTEGER
);

CREATE TABLE entries (
  user_id        TEXT    NOT NULL REFERENCES users(id),
  id             TEXT    NOT NULL,          -- device-generated uuid: the idempotency key
  body           TEXT    NOT NULL,
  created_at     TEXT    NOT NULL,
  occurred_at    TEXT,
  category_id    TEXT,
  tags           TEXT    NOT NULL DEFAULT '[]',  -- JSON array
  origin         TEXT    NOT NULL DEFAULT 'author',
  updated_at     TEXT    NOT NULL,
  deleted_at     TEXT,
  server_version INTEGER NOT NULL,
  received_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)                 -- built-in ids repeat across accounts (H1b `cat-*`)
);
CREATE INDEX entries_user_version ON entries(user_id, server_version);
CREATE INDEX entries_user_created ON entries(user_id, created_at);

-- The text an edit replaced, kept when the edit was made against an older version (§6.3): nothing is lost.
CREATE TABLE entry_revisions (
  user_id        TEXT    NOT NULL,
  id             TEXT    NOT NULL,
  server_version INTEGER NOT NULL,          -- the version that was replaced
  body           TEXT    NOT NULL,
  deleted_at     TEXT,
  replaced_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, id, server_version)
);
