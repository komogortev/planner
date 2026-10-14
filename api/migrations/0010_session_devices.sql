-- D-22 (DECISION-TREE; D-90 pulled it before any invitee can register a model): a user lists their own sessions and signs
-- out the ones they do not recognise. `device` is a coarse label taken from the sign-in request ("Chrome on Android"),
-- never the full User-Agent; `last_seen_at` moves at sign-in and on the at-most-daily renewal, so it costs no extra
-- writes. Additive only: sessions from before stay valid and list with no label until their next sign-in.
ALTER TABLE sessions ADD COLUMN device TEXT;
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
