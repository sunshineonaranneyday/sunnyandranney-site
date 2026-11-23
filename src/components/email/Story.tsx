/** @jsxImportSource preact */
import { PART_LIMITS, STORY_DEFAULTS } from '@/lib/sunny-side/parts.mjs';
import { type Parts, fieldId } from './model';
import { TextField } from './parts';

/** The story's words: what's new in the showroom this week, under the products. Its photos are the collage above. */
export function Story({ parts, setParts, shown }: { parts: Parts; setParts: (change: (p: Parts) => Parts) => void; shown: (key: string) => string | undefined }) {
  const s = parts.story;
  const set = (patch: Partial<Parts['story']>) => setParts((p) => ({ ...p, story: { ...p.story, ...patch } }));
  return (
    <div class="em-story">
      <TextField id={fieldId('story.label')} label="Small label" value={s.label} limit={PART_LIMITS.label} placeholder={STORY_DEFAULTS.label} onInput={(v) => set({ label: v })} error={shown('story.label')} />
      <TextField id={fieldId('story.headline')} label="Headline" value={s.headline} limit={PART_LIMITS.headline} onInput={(v) => set({ headline: v })} error={shown('story.headline')} hint="Like “Christmas is here.”" />
      <TextField id={fieldId('story.body')} label="The story" value={s.body} limit={PART_LIMITS.body} rows={4} onInput={(v) => set({ body: v })} error={shown('story.body')} hint="Two or three sentences about what’s new on the floor." />
      <div class="field-row">
        <TextField id={fieldId('story.cta')} label="Link’s words" value={s.cta} limit={PART_LIMITS.cta} placeholder={STORY_DEFAULTS.cta} onInput={(v) => set({ cta: v })} error={shown('story.cta')} />
        <TextField id={fieldId('story.link')} label="Goes to" value={s.link} placeholder={STORY_DEFAULTS.link} onInput={(v) => set({ link: v })} error={shown('story.link')} hint="A page on sunnyandranney.com." />
      </div>
    </div>
  );
}
