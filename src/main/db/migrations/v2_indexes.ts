// Schema v2: indexes for global search and history views (kept separate to exercise the upgrade path).
export const V2_GENERATED_CONTENT_INDEX = `
CREATE INDEX IF NOT EXISTS idx_generated_kind ON generated_content(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_vocabulary_topic ON vocabulary(topic);
CREATE INDEX IF NOT EXISTS idx_favorites_kind ON favorites(kind);
CREATE INDEX IF NOT EXISTS idx_bookmarks_kind ON bookmarks(kind, ref);
`
