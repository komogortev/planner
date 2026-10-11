-- HW-HARNESS S2 (HW-HARNESS.md §5, D-62): the harness and widget records. Additive only — `entries` and `entry_revisions` are
-- untouched, so an older client (which sends no `recordKind` and ignores a `records` field in a pull) keeps working.
--
-- One table for the seven kinds (assessment, question, link, entryState, widget, report, run), keyed by kind: they share the
-- push/pull protocol and the per-account `server_version` counter with entries, so one cursor orders every change. The kind's
-- own fields are one JSON text in a fixed key order (the validator in src/domain/records.ts writes it), so equal content is
-- equal text and a replay is told from an edit by comparing strings. A typed table per kind would copy the same sync code
-- seven times for nothing the Worker queries by.
--
-- Times the server stamps are epoch ms (as in 0002/0004); times the device writes stay its ISO strings, inside `data`.

CREATE TABLE records (
  user_id        TEXT    NOT NULL REFERENCES users(id),
  kind           TEXT    NOT NULL,
  id             TEXT    NOT NULL,          -- device-derived (uuid v5 or built-in name); entryState uses its entry's id
  data           TEXT    NOT NULL,          -- JSON of the kind's own fields, without id and deletedAt
  deleted_at     TEXT,
  server_version INTEGER NOT NULL,          -- from users.version_seq, the same counter as entries
  received_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, id)           -- the same id may exist in two kinds (an entryState has its entry's id)
);
CREATE INDEX records_user_version ON records(user_id, server_version);

-- What an edit made against an older version replaced (the owner's answers and widget instructions are their own writing):
-- nothing is lost, same rule as entry_revisions.
CREATE TABLE record_revisions (
  user_id        TEXT    NOT NULL,
  kind           TEXT    NOT NULL,
  id             TEXT    NOT NULL,
  server_version INTEGER NOT NULL,          -- the version that was replaced
  data           TEXT    NOT NULL,
  deleted_at     TEXT,
  replaced_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, id, server_version)
);
