-- Site search: what shoppers search for, how many pieces each search found, and which
-- piece they opened. For the admin's Search page: the searches that found nothing are
-- the words the search doesn't know yet (src/lib/search/lexicon.mjs).
-- Nothing about the shopper is kept: no IP, no cookie, no account. Rows go after 180 days.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS search_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- ISO time, UTC.
  at TEXT NOT NULL,
  -- 'search': a results page was shown. 'click': a piece was opened from a search.
  kind TEXT NOT NULL CHECK (kind IN ('search', 'click')),
  -- The words searched: lowercase, single spaces, anything like an email or a phone number taken out.
  query TEXT NOT NULL,
  -- search: how many pieces it found.
  results INTEGER,
  -- click: the piece's handle, and its place in the list (1 is the first).
  handle TEXT,
  position INTEGER,
  -- 'page' (/shop/?q=) or 'panel' (the search box's suggestions).
  source TEXT NOT NULL CHECK (source IN ('page', 'panel'))
);

CREATE INDEX IF NOT EXISTS search_events_at ON search_events (at);
CREATE INDEX IF NOT EXISTS search_events_query ON search_events (query, at);
