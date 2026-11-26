/**
 * "Don't send it again" on a sent email's page (/admin/email/sent/<id>/): asks once in place, then
 * turns off the email going again to the people who didn't open it, and reloads to show it's off.
 */
export function wireAgainStop() {
  const box = document.querySelector<HTMLElement>('[data-again-stop]');
  if (!box || !box.querySelector('[data-ask]')) return;
  const send = box.dataset.againStop ?? '';
  const ask = box.querySelector<HTMLButtonElement>('[data-ask]');
  const confirm = box.querySelector<HTMLElement>('[data-confirm]');
  const keep = box.querySelector<HTMLButtonElement>('[data-keep]');
  const stop = box.querySelector<HTMLButtonElement>('[data-stop]');
  const problem = box.querySelector<HTMLElement>('[data-problem]');
  if (!ask || !confirm || !keep || !stop || !problem) return;
  const asking = (on: boolean) => {
    ask.hidden = on;
    confirm.hidden = !on;
    (on ? keep : ask).focus();
  };
  ask.addEventListener('click', () => asking(true));
  keep.addEventListener('click', () => asking(false));
  stop.addEventListener('click', async () => {
    stop.disabled = true;
    stop.textContent = 'Turning it off…';
    problem.hidden = true;
    let error = '';
    try {
      const res = await fetch('/api/admin/email/again/', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ send }) });
      if (res.ok) return location.reload();
      error = ((await res.json().catch(() => ({}))) as { error?: string }).error || 'It didn’t turn off. Try again.';
    } catch {
      error = 'The site didn’t answer. Try again.';
    }
    problem.textContent = error;
    problem.hidden = false;
    stop.disabled = false;
    stop.textContent = 'Don’t send it again';
  });
}
