-- Accounts for H1 sign-in. One user can hold several provider identities.
CREATE TABLE users (
  id         TEXT    PRIMARY KEY,
  email      TEXT    NOT NULL UNIQUE,
  name       TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE identities (
  provider         TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id          TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (provider, provider_user_id)
);

-- Only the SHA-256 of a bearer token is stored; a leaked table cannot be replayed.
CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
