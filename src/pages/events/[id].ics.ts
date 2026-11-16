import type { APIRoute } from 'astro';
import { icsFor } from '@/lib/sunny-side/events.mjs';
import { getEvent } from '@/lib/sunny-side/event-store.mjs';
import { localDate } from '@/lib/time-clock/hours.mjs';

// Served fresh from the event Staci saved, with only the dates still ahead today, so an email
// read weeks later never adds a date that has passed. The weekly email links here for Apple
// Calendar and Outlook.
export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
  // At /events/<id>.ics/ (icsUrl): calendar apps go by the file's type and name below, not the address
  const id = /^[a-z0-9][a-z0-9-]{0,80}$/.test(params.id ?? '') ? params.id! : null;
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
