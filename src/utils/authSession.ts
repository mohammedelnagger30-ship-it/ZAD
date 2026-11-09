import type { Session } from '@supabase/supabase-js';

/**
 * An empty auth response can mean the refresh request could not complete.
 * Keep the locally persisted session until the user explicitly signs out.
 */
export function preserveSessionOnEmptyAuthResponse(
  currentSession: Session | null,
  receivedSession: Session | null,
): Session | null {
  return receivedSession ?? currentSession;
}
