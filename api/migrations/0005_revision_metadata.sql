-- H1-S2 step 4 review: a replaced row kept only its text, so a stale edit silently overwrote the other device's tags,
-- category, dates with no copy. The rest of the replaced row goes here as JSON (createdAt, occurredAt, categoryId, tags,
-- updatedAt). Nullable: rows written before this existed (none in production — 0004 was never applied remotely) have none.
ALTER TABLE entry_revisions ADD COLUMN meta TEXT;
