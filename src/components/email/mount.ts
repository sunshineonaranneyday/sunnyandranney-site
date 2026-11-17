import { h, hydrate } from 'preact';
import { toast } from '@/lib/admin/shell';
import { usePhotoOrigin } from '@/lib/sunny-side/email.mjs';
import EmailApp from './EmailApp';
import type { AppProps } from './model';

/**
 * Takes over the page the server already drew. Not an Astro island: islands start from an
 * inline script, which the admin's CSP refuses. The component also renders on the server, so it
 * asks for toasts with an event instead of importing the shell.
 */
export function mountEmail(): void {
  const root = document.getElementById('email-root');
  const data = document.getElementById('email-data');
  if (!root || !data?.textContent) return;
  document.addEventListener('admin:toast', (e) => {
    const { message, tone } = (e as CustomEvent<{ message: string; tone?: 'ok' | 'error' }>).detail;
    toast(message, tone);
  });
  const props = JSON.parse(data.textContent) as AppProps;
  // On a developer's machine the uploads are in the local bucket, not on the live site: the
  // preview shows them from here, as they are
  if (props.local) usePhotoOrigin(location.origin, { direct: true });
  hydrate(h(EmailApp, props), root);
  keepBarHeight();
}

/**
 * On a phone, Save leaves the page's top bar for the bottom of the screen at the first change, and the
 * bar used to close up behind it: everything below moved up 56px (85px under 375px, where Save takes
 * two lines), under the finger that made the change. iPhone Safari even put the page back only at the
 * next touch, and swallowed that tap. So the bar notes its own height while nothing is unsaved, and
 * keeps that height after Save moves (--em-bar-h, email.css).
 */
function keepBarHeight(): void {
  const em = document.querySelector<HTMLElement>('.em');
  const bar = em?.querySelector<HTMLElement>('.em-bar');
  if (!em || !bar || typeof ResizeObserver !== 'function') return;
  const note = () => {
    if (!em.classList.contains('is-dirty')) em.style.setProperty('--em-bar-h', `${bar.offsetHeight}px`);
  };
  new ResizeObserver(note).observe(bar);
  note();
}
