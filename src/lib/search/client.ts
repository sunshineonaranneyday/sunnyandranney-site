/**
 * The search index in the browser: fetched once (on the first focus of a search box, or a
 * /shop/?q= page), built in a few milliseconds, then kept for every page the shopper moves
 * to (the site changes pages without reloading).
 */
import { buildIndex } from './engine.mjs';

type Index = ReturnType<typeof buildIndex>;
type Early = Window & { __srIndex?: Promise<Response>; __srIndexReady?: boolean; __srIndexLoading?: boolean };
/** A stalled download gives up, so a results page falls back to matching words instead of staying blank. */
const TIMEOUT_MS = 10_000;
let loading: Promise<Index> | null = null;

export function loadSearchIndex(): Promise<Index> {
  if (loading) return loading;
  // A /shop/?q= page starts the download in its first lines (shop/index.astro); use that one.
  const w = window as Early;
  const response = w.__srIndex ?? fetch('/shop/search-index.json', { credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS) });
  delete w.__srIndex;
  w.__srIndexLoading = true; // so a /shop/?q= page that opens meanwhile doesn't download it again
  loading = response
    .then((res) => {
      if (!res.ok) throw new Error(`search index: HTTP ${res.status}`);
      return res.json() as Promise<{ docs: Parameters<typeof buildIndex>[0] }>;
    })
    .then(({ docs }) => {
      w.__srIndexReady = true;
      w.__srIndexLoading = false;
      return buildIndex(docs);
    })
    .catch((err) => {
      loading = null; // the next try fetches again
      w.__srIndexReady = false;
      w.__srIndexLoading = false;
      throw err;
    });
  return loading;
}

/** Starts the download without waiting for it: called as soon as a shopper heads for a search box. */
export function warmSearchIndex(): void {
  void loadSearchIndex().catch(() => {});
}
