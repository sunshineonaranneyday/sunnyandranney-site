/** @jsxImportSource preact */
import { PART_LIMITS, linesOf } from '@/lib/sunny-side/parts.mjs';
import { type Parts, fieldId } from './model';
import { TextField } from './parts';

/**
 * The subject and preview line: what people see in their inbox before they open it. {offer} and
 * {upto} are written from the sale, so the lines can't promise more than it gives.
 */
export function Subject({ parts, setParts, sale, shown }: { parts: Parts; setParts: (change: (p: Parts) => Parts) => void; sale: object | null; shown: (key: string) => string | undefined }) {
  const lines = sale ? linesOf(parts, sale) : null;
  const clean = (t: string) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  return (
    <div class="em-subject">
      <TextField
        id={fieldId('subject')}
        label="Subject line"
        value={parts.subject}
        limit={PART_LIMITS.subject}
        onInput={(v) => setParts((p) => ({ ...p, subject: v }))}
        error={shown('subject')}
        hint={<>Type {'{offer}'} for the sale in a few words, or {'{upto}'} for its biggest discount. Like “Christmas is in store! Save up to {'{upto}'}”.</>}
      />
      <TextField
        id={fieldId('preheader')}
        label="Preview line"
        value={parts.preheader}
        limit={PART_LIMITS.preheader}
        placeholder="{offer}"
        onInput={(v) => setParts((p) => ({ ...p, preheader: v }))}
        error={shown('preheader')}
        hint="The grey line after the subject in most inboxes. Left empty, it says the sale."
      />
      {lines && parts.subject && !shown('subject') && !shown('preheader') && (
        <div class="em-inbox" aria-label="How it reads in an inbox">
          <span class="em-inbox-from">Sunny &amp; Ranney</span>
          <span class="em-inbox-subject">{clean(lines.subject)}</span>
          <span class="em-inbox-pre">{clean(lines.preheader)}</span>
        </div>
      )}
    </div>
  );
}
