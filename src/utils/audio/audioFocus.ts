/**
 * One sound at a time.
 *
 * The app has more than one thing that can make noise — the Qur'an recitation, and now
 * the lectures — and two of them playing together is never what the listener meant. Each
 * source registers how to silence itself, and asks for the floor before it starts; the
 * others stand down.
 *
 * A tiny module of its own rather than an import between the two engines: the recitation
 * and the lecture player have no other business knowing about each other, and a cycle
 * between them would be a trap for whoever touches either next.
 */

type StopSource = () => void;

const sources = new Map<string, StopSource>();

/** Which source currently holds the floor. `null` before anything has sounded. */
let holder: string | null = null;

/** Announce a source that can be silenced. Re-registering replaces the previous stopper. */
export function registerAudioSource(id: string, stop: StopSource): void {
  sources.set(id, stop);
}

/** Silence every source except `id`, then hand control to it. */
export function takeAudioFocus(id: string): void {
  // The floor changes hands before anything is silenced, so a stopper that asks
  // {@link hasAudioFocus} sees the new order of things rather than the old one.
  holder = id;
  for (const [sourceId, stop] of sources) {
    if (sourceId !== id) stop();
  }
}

/**
 * Whether `id` currently holds the floor.
 *
 * Silencing is not instantaneous: `audio.pause()` fires its `pause` event on a queued
 * task, so a player that has just been interrupted still gets to run its own handlers a
 * moment later. Those handlers must not act — in particular they must not write to the
 * shared player card, which the new holder has already claimed. Asking here is how a
 * silenced source keeps quiet.
 */
export function hasAudioFocus(id: string): boolean {
  return holder === id;
}

/** Test seam — the registry is module state and would otherwise leak between tests. */
export function resetAudioFocus(): void {
  sources.clear();
  holder = null;
}
