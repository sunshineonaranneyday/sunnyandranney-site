import type { APIRoute } from 'astro';
import { icsFor } from '@/lib/sunny-side/events.mjs';
import { getEvent } from '@/lib/sunny-side/event-store.mjs';
import { localDate } from '@/lib/time-clock/hours.mjs';

// Served fresh from the event Staci saved, with only the dates still ahead today, so an email
// read weeks later never adds a date that has passed. The weekly email links here for Apple
// Calendar and Outlook.
export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
  // From the address itself: the middleware's rewrite of "<id>.ics" to "<id>.ics/" doesn't carry the route's params
  const id = url.pathname.match(/^\/events\/([a-z0-9][a-z0-9-]{0,80})\.ics\/?$/)?.[1];
  const record = id ? await getEvent(locals.runtime.env.DB, id) : null;
  const today = localDate(new Date().toISOString());
  if (!record || !record.event.dates.some((d: { date: string }) => d.date >= today)) {
    return new Response('This event is over, or it isn’t on the calendar anymore. See what’s on at sunnyandranney.com/visit/', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(icsFor(record.event, { today, updatedAt: record.updatedAt }), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${id}.ics"`,
      // Short, so a date that passes drops out within the hour
      'Cache-Control': 'public, max-age=900',
    },
  });
};
