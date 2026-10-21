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

/** Announce a source that can be silenced. Re-registering replaces the previous stopper. */
export function registerAudioSource(id: string, stop: StopSource): void {
  sources.set(id, stop);
}

/** Silence every source except `id`, then hand control to it. */
export function takeAudioFocus(id: string): void {
  for (const [sourceId, stop] of sources) {
    if (sourceId !== id) stop();
  }
}

/** Test seam — the registry is module state and would otherwise leak between tests. */
export function resetAudioFocus(): void {
  sources.clear();
}
