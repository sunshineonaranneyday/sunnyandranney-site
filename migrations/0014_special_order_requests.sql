-- Special-order requests: a shopper asks for a piece that's sold out but can be
-- ordered from its vendor (the product page's "Request this piece"). The store
-- confirms the price and arrival date with the vendor, then replies.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS special_order_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  -- The piece, as Shopify had it when the request came in.
  handle TEXT NOT NULL,
  title TEXT NOT NULL,
  vendor TEXT,
  price_cents INTEGER,
  -- Its first photo (Shopify's CDN), for the emails.
  image_url TEXT,
  -- The vendor's lead time the page showed, if the admin had one.
  lead_days INTEGER,
  -- The shopper. At least one of email or phone.
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  note TEXT,
  -- The day the shopper was told to expect an answer (YYYY-MM-DD, the store's next
  -- open day), worked out once when the request came in; the page and the email use it.
  reply_by TEXT,
  -- new → replied → ordered or closed. Each step records who and when.
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'replied', 'ordered', 'closed')),
  replied_at TEXT,
  replied_by TEXT,
  closed_at TEXT,
  closed_by TEXT,
  -- The outbox: the store-notify worker emails the store and the shopper, then
  -- stamps these. A failed send is retried on the next run.
  store_emailed_at TEXT,
  shopper_emailed_at TEXT,
  -- Set instead of sending when this address already had 3 confirmations in a day:
  -- the form can't be used to fill someone's inbox.
  shopper_email_skipped TEXT,
  email_attempts INTEGER NOT NULL DEFAULT 0,
  email_error TEXT,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_special_order_requests_status ON special_order_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_special_order_requests_outbox ON special_order_requests(store_emailed_at, shopper_emailed_at);
