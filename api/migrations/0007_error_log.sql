-- S4 (DECISION-TREE D-24): errors the app reports about itself. Type, route and build only — never a message, never
-- entry text, no user id. Capped at 500 rows by the route that writes it. Not an account table (ACCOUNT_EXEMPT).
CREATE TABLE error_log (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  at    INTEGER NOT NULL,
  kind  TEXT    NOT NULL,
  route TEXT    NOT NULL,
  build TEXT    NOT NULL
);
