/**
 * Email-again worker: every two minutes, asks the site to do whatever is due in sending the
 * weekly email again to the people who didn't open it (src/lib/sunny-side/again-run.mjs). The
 * site holds the Kit key and does the work; this only keeps time. Most calls find nothing due.
 */

// @ts-ignore: plain JS module shared with the site and its tests
import { againRequest } from '../../../src/lib/sunny-side/again-call.mjs';

interface Env {
  AGAIN_URL: string;
  EMAIL_AGAIN_SECRET?: string;
}

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    if (!env.EMAIL_AGAIN_SECRET) {
      console.error('email-again: EMAIL_AGAIN_SECRET isn’t set, so the site won’t take the call');
      return;
    }
    const { url, init } = againRequest(env.AGAIN_URL, env.EMAIL_AGAIN_SECRET);
    // A run spends at most about a minute with Kit (again-run.mjs BUDGET × GAP_MS)
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
    const text = await res.text();
    if (!res.ok) {
      console.error(`email-again: the site answered ${res.status}: ${text.slice(0, 500)}`);
      return;
    }
    // Only runs that did something are worth a line in the log
    try {
      const r = JSON.parse(text) as { did?: string[] };
      if (r.did?.length) console.log(text);
    } catch {
      console.error(`email-again: the site answered with something that isn’t JSON: ${text.slice(0, 200)}`);
    }
  },
};
