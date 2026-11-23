# The Sunny Side (the store's weekly email)

`build.mjs` turns one weekly brief into the Kit-ready email, in the team's chosen design: B, "Sunny" (bold color blocks and edge-to-edge photos). `verify.mjs` holds every build to the standard below.

The email itself is `src/lib/sunny-side/email.mjs`. It's the same code the admin uses for the live preview on the weekly email page, so that preview is the email.

```
node scripts/sunny-side/build.mjs      # every brief -> out/, every stress test -> out/tests/
node scripts/sunny-side/verify.mjs     # 6 renders per email; exits 1 on any failure
```

## Each week

1. Staci sets up the week's email at admin.sunnyandranney.com/admin/email/: the sale, 4 to 9 products from the shop, and the store's events (below).
2. Mike, the photographer, shoots the top photo, and the story photo when there is a story.
3. Fill a brief in `briefs/` with `"sale": "admin"`, `"wall": "admin"` and `"events": "admin"`, then build, verify, and test-send to Peter's inbox through Cloudflare Email Sending. Staci and Holly approve the test, then it goes into Kit.

`"admin"` makes the build read what Staci saved from the store's D1 database, using wrangler: the special and the products for the brief's `send_date`, and every event with a date still ahead on it. If she hasn't saved the special or the products yet, that brief isn't built and the build says so. `--local` reads the local dev database instead (`node scripts/sunny-side/build.mjs --local brief.json`). The sale, the products and the events are Staci's to set there; a brief never asks anyone else for them.

The build tries every brief, so one waiting on the admin doesn't hold up the rest, then lists any it couldn't build and exits 1. A brief that fails, or is gone, leaves no old email in `out/`, so `verify.mjs` can't pass a stale one. Each built email prints its subject as it will go out.

## The brief

Every field below is used. Nothing else is read.

- `send_date` (YYYY-MM-DD): event dates before it drop out, and it names the UTM campaign (`sunny-side-<send_date>`).
- `subject`, `preheader`. Since the offer comes from the admin, they name it without typing its numbers: `{offer}` becomes the offer in a line ("Spend $250, save 10%. Spend $1,000, save 20%.", the first and last tier, or "20% off everything.") and `{upto}` its biggest percent ("20%"). Anything either line says about the discount is checked against the offer, and a mismatch stops the build: every percent off must be one the sale gives, "up to" must be its biggest, and with tiers every dollar amount must be a tier, with that tier's own percent beside it ("100% of our profits" is a share, so it's left alone).
- `sale`: `"admin"` (above) for a real week, or the offer itself (the stress tests). The offer has `name` (the small label), `cta`, `url` (a site path), optional `details` (fine print, shown under the button), and by `kind`:
  - `tiers`: `headline`, `tiers` as `[[spend, percent], ...]`, 2 to 4 of them. Four tiers, or any tier from $10,000 up, write every amount short, like `$2.5k+`.
  - `percent`: `percent`, `what` (e.g. `"everything."`)
  - `headline`: `headline`
- `hero`: `src`, `alt`.
- `wall`: `"admin"` (above) for a real week, or the wall itself: `label`, `headline`, optional `more` (the site path "Shop all" goes to; the whole shop by default, so it matches what the products are), and `photos` (4 to 9 products). Say only what's true of the picks: "Just landed" needs products that really are new. Each product is:
  - `url`: its page on sunnyandranney.com/shop/, where it can be bought;
  - optional `src`: a photo to use instead of the product's first store photo;
  - optional `name`: a short name, needed only when the store's name runs over 28 characters (the build says when).

  The build reads each product's name, price and photos from its page, the same structured data search engines read, and its stock from the shop page's own count (the number the site's filters use; a product page says "InStock" even at zero when the store sells on order). A product with none in stock, a name too long for a tile, two tiles with the same name, a PNG photo Shopify won't send as a JPEG, or a page it can't read stops the build, with every problem listed at once. A real brief can't give its own `price`; only the stress tests in `tests/` do, so they run offline. Each tile is one link: the photo, then the name in bold, then the price. The photo needs no alt, because the name under it is in the same link.
- `story` (optional): `label`, `headline`, `body`, `photo` (`src`, `alt`), `cta` as `[text, site path]`.
- `events`: `"admin"` (above) for a real week, or the list itself (the stress tests): `title`, `time` (the series' hours), optional `label` (default "Coming up"), and `items`. The line under the title is written from the dates still ahead ("Saturdays, 11am–2pm, Nov 21 to Dec 19"), so it never goes stale. With one date left there's no line, because the card says it all. Only events on different weekdays take a `when`, saying what's on ("Late shopping nights and Saturday crafts for kids"); the dates are added after it. A `when` that names a date, or a `when` on a one-weekday series, stops the build. Each item has:
  - `date` (YYYY-MM-DD; month, day and weekday come from it), `what`;
  - optional `note`, `time` (only when it differs from the series), and `greg` (Greg's photo when that date is the spotlight).
  - Optional `calendar` (weekly series only): `title`, `start` and `end` (HH:MM), `intro` (the first line of the calendar notes) and `ics` (the series' file). The Google link starts at the next date still ahead and lists only the dates left, so no one adds one that has passed. From the admin, the file is the site's `/events/<event>.ics/`, made fresh from the event with only the dates still ahead that day.
  - Optional `one` (any event): `title`, `start`, `end`, and the event's `site` and `id`. The card that leads the event gets links for its next date alone; Apple and Outlook get that date's own file, `/events/<event>/<date>.ics/`. Every address on the site that an email points at ends in a slash (`addresses.mjs`): the site uses `trailingSlash: 'always'`, and in production a file address without one matches no route and gets the 404 page.
- `mission`: the charity section.
  - `photo` (`src`, `alt`): the latest reveal.
  - `caption`: who's in it, like "Remi and Nico, ages 14 and 12, in their new bathroom."
  - `story`: two sentences on what changed for them.
  - `cta`, `url`: the button and their page on sunshineonaranneyday.com.
  - `impact`: `"live"` reads the charity's room makeovers and children served from its brand page (sunshineonaranneyday.com/branding/) at build time. If it can't, the build stops rather than printing old numbers. The stress tests use fixed numbers.

Photo `src` is either a full image URL or `cf:<id>` for Cloudflare Images, which crops around the subject. Every Shopify photo goes out as a JPEG (`Email.photo` in `email.mjs`):
- Shopify resizes its JPEG, WebP, AVIF and HEIC photos and sends them as JPEGs (`format=jpg`), which Outlook can show.
- The store's own uploads (`photo:<id>`) and its Shopify PNGs go through Cloudflare's image resizing (`https://shop.sunnyandranney.com/cdn-cgi/image/…,format=jpeg,background=white/<Shopify URL>`). It runs only on hostnames Cloudflare proxies; sunnyandranney.com itself is DNS-only to the Pages site, so it's served from shop.sunnyandranney.com, the proxied hostname that redirects old shop links. Keep that hostname proxied. Shopify won't convert a PNG saved with a transparency channel, even one with nothing see-through, and Mac screenshots save one, so those came back as PNGs of 175–500KB a tile. On Nov 12, 2026, 59 of the 193 products in stock had only PNGs like that; of the 51 checked, 49 were screenshots, all fully solid.
- The domain's resizing was turned on Nov 12, 2026, in the dashboard (Images → Transformations; setting it through the API to "on" leaves it disabled). It accepts only the store's own Shopify files (`cdn.shopify.com/s/files/1/0930/2117/6092/`), so a PNG from anywhere else is left to Shopify's resizing. After 5,000 different resized images a month, Cloudflare charges $0.50 per 1,000.

`tests/` holds stress-test briefs: quiet week (one of its tiles is a screenshot PNG, so the resizing is checked on every run), four tiers, $10,000+ tiers, nine photos, events over, mixed weekdays. On their own they cover every photo-wall layout (4 to 9 photos), every tier count and all three sale kinds, so the standard is held even in a week whose brief is still waiting on the admin. They are built and verified with every run.

## The weekly email in the admin

`/admin/email/` is for managers. Staci picks this Tuesday's email or one of the next three, and sets up the whole email beside a live preview of it, drawn by the same code that builds it, then sends tests and schedules it to subscribers through Kit from the page. The preview follows the part she's working on. One Save keeps the sale and the products together; either can be saved before the other is ready. Saving checks the version the page loaded, so two managers can't overwrite each other. The Today page shows a task when the coming Tuesday's email has no sale or no products. `/admin/special/`, the page's old address, redirects here.

1. **The sale.** One of three kinds, and only what that kind needs:
   - spend more, save more: 2 to 4 tiers;
   - percent off;
   - no discount, a headline instead.

   A discount can't be saved without its last day. Every sale counts in the showroom and online, so that's never asked: the fine print under the button always starts "In the showroom and online. Ends Sunday, Nov 29.", then anything else she adds. The button, the small label and more fine print have good defaults, so they're folded away with what they say now. The button opens the whole shop by default for spend more, save more and for a percent off everything, since both count the whole order and the sale page lists only marked-down items.

2. **The products.** She browses the shop's own catalog (`/shop/catalog.json`, published with every deploy by `src/pages/shop/catalog.json.ts`): every product the shop lists, with its stock count and its photos' sizes. The picker works like Shopify's own: search by name, room or kind; narrow to new arrivals, staff picks or what's on sale, or by room; sort by best selling (Shopify's own ranking), newest or price; scroll through all of them; tap to add or take out. Products that are sold out show only when asked. One in stock with no photo at all shows greyed. Any photo can be picked: the email sends every one as a JPEG.

   The picks are laid out the way the email lays them out, and arranged for her: best sellers first, the widest photo leading an odd wall (a tall photo cropped 3:2 loses its top and bottom), and two of a kind never side by side when something else can go between them. She can drag any product to a new place, or use its arrows (a way to move them without dragging, as WCAG 2.5.7 asks). Once she moves one, her order holds until she asks for it to be arranged again. She can pick which of a product's photos the email shows. A name too long for a tile gets a suggested short name when one can be made cleanly ("Hamlin Swivel Chair, Beamer Blue" becomes "Hamlin Swivel Chair"), or a field for hers. Two tiles can't say the same name. The words over the products default to "Shop the floor / Our picks this week." and can say "new" only if every product was added in the last 30 days.

3. **Photos.** She uploads the week's photos from a phone or computer. The browser shrinks each to a JPEG at most 2,400 px across before it goes up (a phone's 5 MB shot becomes a few hundred KB). They're kept in the R2 bucket `sunnyandranney-email-photos` (binding `PHOTOS`), with a row each in D1 table `email_photos` (`photo-store.mjs`), and served at `/media/email/<id>.jpg`. The email asks for them through the domain's resizing (`photo:<id>` in `Email.photo`), cropped to each spot around what's in them. Each photo has a few words saying what's in it, for people who can't see images. She picks one as the top photo (or keeps the store's wide shot) and up to 5 for the story's collage, in the order she wants; "Put the widest first" arranges them. The collage is laid out by count, like the products wall: one wide photo; two side by side; one wide over two; one wide over three; one wide over two rows of two (`COLLAGE_ROWS`).

4. **The story.** A small label, a headline, two or three sentences, and a link to a page on sunnyandranney.com.

5. **Events.** Events are the store's, not one email's: each email shows the dates still ahead on its send day. An event is a name, its hours, and its dates, each with what's on, an optional note, and whether Greg's photo shows. "Add" suggests the date a week after the last one. Dates on different days of the week need a few words saying what's on (no dates in them). The card for the next date gets its own Google, Apple and Outlook links for that date alone (`/events/<event>/<date>.ics`), for any event; a series a week apart also gets links for every date still ahead, once there's more than one. Each date keeps the same calendar UID either way, so adding the date and later the series doesn't put it on a calendar twice. Each event saves on its own, and its calendar file (`/events/<event>.ics`) is made from it on request with only the dates still ahead, so it never goes stale.

6. **The charity.** A dropdown of the charity's kids; nobody at the store writes any of it. The section shows the chosen family's photo and the charity's own summary from its site, with "See their story" to their page, and the charity's numbers read live. It starts on the most recent reveal: the latest reveal date the charity has on record that has passed (its reveal invites keep them, from November 2026), and for reveals from before then, the day their photos went up (the charity's photo ids carry the time). The list is read from the charity's own database (`soard-db`, bound as `SOARD_DB`, only ever read; `kids.mjs`): its published kids that have had their reveal and have a photo and summary.

7. **Subject line.** The subject and the preview line. `{offer}` writes the sale in a few words and `{upto}` its biggest discount, and neither line can promise more than the sale gives (the same check the build makes). An empty preview line says the sale. The page shows how it reads in an inbox.

8. **Send.** Kit sends both the tests and the email, from here; nobody needs to open Kit.
   - A list says what's left before it can go, each item linking to its section.
   - **Send a test** goes to whoever's ticked: the person signed in ("You") and the store's list (Mike, Staci and Holly to start; `email_test_people`, never in this public repo). Kit's API has no test send, so a test is a small Kit broadcast of its own, a minute ahead, to just those people: each is a Kit subscriber with a tag of their own ("Weekly email test: <email>"), and someone who unsubscribed is never signed back up. It's exactly what subscribers get, with "[Test]" before the subject. At most 10 people, 20 tests a day; each test is logged (`email_test_sends`).
   - **Send to subscribers** schedules it to every subscriber at a time on its Tuesday, Eastern, starting at the time the store's emails usually go (from Kit's history). A confirmation shows when, how many subscribers, the subject and the preview line. Once it's scheduled the email is locked until it's cancelled ("Cancel the send" deletes it in Kit, until it starts sending).
   - Nothing is ever published to the web. Kit's docs disagree on whether sending needs "public", so every send is made with it off and read back at once: if Kit published it, it's taken off; if Kit kept it as a draft, it's deleted and the page says so. A send that can't be noted here is taken back out of Kit.
   - It goes on a Kit "Starting point" template, where the content is the whole email (`KIT_TEMPLATE_ID`, or the account's first). `kit.mjs` has the calls; `week-email.ts` builds the email for both, from what's saved, so a test is what goes out.

The rules are shared by her browser, the server and the build: `src/lib/sunny-side/special.mjs` (the sale), `wall.mjs` (the products), `events.mjs` (events and their calendar file), `catalog.mjs` (the picker's catalog). The page measures what `verify.mjs` would at 320 and 390 px (the sale button on the first screen, nothing spilling, every product name within two lines) and won't save an email that fails. The weeks live in D1 table `email_weeks` (`week-store.mjs`), the events in `store_events` (`event-store.mjs`). Both create themselves; the first use of `email_weeks` moves any special saved in the page's older `email_specials` table over and drops that table.

The admin page itself is checked with `node scripts/check-admin-boxes.mjs <page>` against a local dev server, at eight widths from 320 to 1440 px, with every folded part open: every piece of text and every control has to stay on the box it's drawn on, no fieldset's legend may sit across its box's edge, and no text may touch the inside edge of a filled panel. A check that only asks whether the page scrolls sideways missed the story's collage label sitting half off its panel, so run this one after any change to how the page looks, once with a section empty and once full.

## The standard

`verify.mjs` renders each email six ways:
- Apple Mail's engine (WebKit) at 320 and 390 px;
- Chrome's engine at 390 px and on desktop;
- Gmail web and the Gmail app, loaded the way Gmail serves the email: no web font, and the CSS Gmail strips taken out.

A render fails on any of these:
- on a phone, a sale button more than 600 px down (about what Apple Mail shows before scrolling);
- a color that isn't a brand color;
- anything off the grid: photo rows must run the full 600 px, and cards and the words that start each line must sit on the 536 px column (20 px margins on phones);
- text spilling out of its box;
- HTML code showing as text;
- a link under 44 px tall;
- heading order;
- a missing alt or a broken image;
- an image with dark artwork on a transparent background (Gmail and Outlook darken backgrounds in dark mode but never images, so that artwork disappears);
- an image that, fetched the way Outlook for Windows would (no WebP or AVIF), isn't a JPEG, PNG or GIF, or weighs over 150 KB (on Nov 12, 2026 the heaviest good image was the 103 KB hero; the screenshot PNGs were 177–493 KB);
- a photo-wall product without its name and price, or a name over two lines;
- sideways scrolling;
- two links to the same address;
- a failed request.

A source check also fails the build on CSS Gmail strips: negative margins, positioning, flex and grid. The build itself stops on a subject or preheader that promises a discount the offer doesn't give, and on a photo-wall product that's out of stock.

## Design rules

- **Colors.** Only the ones the live site shows:
  - gold #FFD400 means buy;
  - teal #2B7A96 means events;
  - charcoal #2C2C2C is for text;
  - stone #6B6B68 is for rules;
  - plus white.
- **The charity section.** "Every purchase builds a dream room" is built the way sunshineonaranneyday.com builds its own home page, from its live styles and its brand guide at /branding/:
  - a Warm Gray #F5F4F0 hero with the guide's small-use logo (no tagline), laid on its own Warm Gray tile (`email/soard-logo-warm-tile` in Cloudflare Images) so its dark lettering stays readable in dark mode;
  - a "Where 100% of our profits go" label;
  - a Libre Baskerville headline whose key words are italic over the site's yellow highlighter (Sunshine Yellow at 30% over the lower half);
  - the reveal photo, rounded like the site's, with a caption;
  - a two-sentence story in Outfit;
  - the site's yellow pill button;
  - then its impact strip: Sunshine Yellow #FFDA24 numbers on Dark Deep #1E1F25.

  `verify.mjs` holds the section (class `soard`) to the charity's colors and everything else to the store's.
- **Font.** DM Sans; the charity section uses Libre Baskerville and Outfit. Outlook falls back to Arial and Gmail to Helvetica. The charity headline falls back to Georgia, but its numbers to Times New Roman, because Georgia's old-style figures made "$0" read as "$o".
- **Layout.** Words and cards sit on one 536 px column; photos run the full 600 px. A photo sits directly on top of the block it belongs to, and white space separates it from any block it doesn't. The photo wall's gaps sit inside its tiles, because Gmail strips the negative margins that would otherwise do it. The wall is never more than two products across, so a name and price stay readable on a 320 px phone; an odd count leads with one wide product.
- **First screen.** A slim masthead, a 2:1 top photo, and fine print under the button keep the sale button on a phone's first screen.

The rest is in the `email.mjs` header.

`{{ address }}` and `{{ unsubscribe_url }}` are Kit tags that Kit fills in at send time.
