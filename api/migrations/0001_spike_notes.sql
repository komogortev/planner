-- H1-S1 spike only: proves a D1 write + read round trip. Dropped when the spike closes (H1-S1-SPIKE.md step 8).
CREATE TABLE spike_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
