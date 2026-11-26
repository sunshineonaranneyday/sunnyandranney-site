# Email-again worker

Every two minutes, calls the site's `/api/email-again/` with its secret. The site
does whatever is due in sending the weekly email again to the people who didn't
open it (`src/lib/sunny-side/again-run.mjs`; how it works is in
`scripts/sunny-side/README.md`, under Send). The site holds the Kit key; this
worker only keeps time. A call with nothing due reads one D1 table and returns.

## Settings

| Setting | What it is |
|---|---|
| `EMAIL_AGAIN_SECRET` | Secret. The same value as the site's `EMAIL_AGAIN_SECRET` (Pages project `sunnyandranney-site`, production). Without it on both, nothing runs. |
| `AGAIN_URL` | Plain variable in `wrangler.toml`: the site's `/api/email-again/`, slash-ended (the site matches routes only at their slash-ended address). |

```sh
npm run deploy:email-again
npx wrangler secret put EMAIL_AGAIN_SECRET --config workers/email-again/wrangler.toml
```

The log (`npx wrangler tail email-again`) has a line only for runs that did
something, or failed.
