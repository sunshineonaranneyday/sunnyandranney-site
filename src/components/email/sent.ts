import { withAdminFont } from './font';

/**
 * Shows a sent email in its frame on /admin/email/sent/<id>/: Kit's HTML, as Kit sent it, drawn the
 * way the page's preview draws the email (written into a blank frame, so the admin's
 * Content-Security-Policy still holds), as tall as the email, with its links opening in a new tab.
 * The frame is sandboxed without scripts, so nothing in an email can run.
 */
export function showSent() {
  const frame = document.getElementById('sent-frame') as HTMLIFrameElement | null;
  const raw = document.getElementById('sent-data')?.textContent;
  if (!frame || !raw) return;
  const { html } = JSON.parse(raw) as { html: string };
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(html ? withAdminFont(html) : '<p style="font: 16px system-ui; padding: 24px; color: #555">Kit has no content for this email.</p>');
  doc.close();
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  // As tall as the email, so the page scrolls it, not the frame
  doc.documentElement.style.overflowY = 'hidden';
  const fit = () => {
    frame.style.height = `${Math.max(200, doc.documentElement.scrollHeight)}px`;
  };
  fit();
  for (const img of doc.images) if (!img.complete) img.addEventListener('load', fit, { once: true });
  new ResizeObserver(fit).observe(doc.body ?? doc.documentElement);
}
