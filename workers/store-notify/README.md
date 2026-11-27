# Store notify worker

Sends the website's special-order requests on. When a shopper asks for a sold-out
piece that its vendor can still supply ("Request this piece" on the product page),
the website saves the request in D1 (`special_order_requests`). Every 5 minutes this
worker emails the store the details, with Reply going to the shopper, and sends the
shopper a confirmation saying when to expect an answer: the next day the store is
open, from `src/content/settings/hours.json`.

The admin's **Special orders** page (`/admin/vendors/special-orders/`) is where a
manager chooses the address the store's copy goes to, answers requests (Answered,
Ordered, Close), and sees how fast they're answered. The Today page shows a card
while any wait.

## How it works

- **Outbox.** The rows are the outbox. Each send stamps `store_emailed_at` or
  `shopper_emailed_at`; a failure adds to `email_attempts` and keeps the error in
  `email_error`, shown on the Special orders page. A row is tried again every run,
  up to 8 times. Nothing is sent twice.
- **No address yet.** Until a manager saves one, shoppers still get their
  confirmation and the store's copies wait, uncounted, until it's set.
- **Sender.** `requests@mail.sunnyandranney.com`, on the domain the sales-tax worker
  already sends from, through the `send_email` binding.
- **Code.** `src/lib/store-notify/special-orders.mjs`, tested against a real local
  D1 in `special-orders.test.mjs`.

## Deploy

```sh
npm run deploy:store-notify
```

The table comes from `migrations/0014_special_order_requests.sql`. The live
database's migration list is out of step with what's applied, so run the file on
its own (it's safe to run twice):

```sh
npx wrangler d1 execute sunnyandranney-db --remote --file migrations/0014_special_order_requests.sql
```
