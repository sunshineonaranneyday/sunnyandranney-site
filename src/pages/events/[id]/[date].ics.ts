import type { APIRoute } from 'astro';
import { icsFor } from '@/lib/sunny-side/events.mjs';
import { getEvent } from '@/lib/sunny-side/event-store.mjs';
import { localDate } from '@/lib/time-clock/hours.mjs';

// One date of a store event, for the link under its next date in the weekly email
// (/events/<event>/<date>.ics/, icsUrl). Served fresh from the event Staci saved, like the whole series
// (../[id].ics.ts), and gone once that date has passed.
export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  const ok = /^[a-z0-9][a-z0-9-]{0,80}$/.test(params.id ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '');
  const [id, date] = ok ? [params.id!, params.date!] : [null, null];
  const record = id ? await getEvent(locals.runtime.env.DB, id) : null;
  const today = localDate(new Date().toISOString());
  if (!record || !date || date < today || !record.event.dates.some((d: { date: string }) => d.date === date)) {
    return new Response('That date has passed, or it isn’t on the calendar anymore. See what’s on at sunnyandranney.com/visit/', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(icsFor(record.event, { today, updatedAt: record.updatedAt, only: date }), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${id}-${date}.ics"`,
      'Cache-Control': 'public, max-age=900',
    },
  });
};
