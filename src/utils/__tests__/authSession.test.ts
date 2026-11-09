import type { Session } from '@supabase/supabase-js';
import { preserveSessionOnEmptyAuthResponse } from '@/utils/authSession';

describe('preserveSessionOnEmptyAuthResponse', () => {
  const cachedSession = { user: { id: 'cached-user' } } as Session;
  const refreshedSession = { user: { id: 'refreshed-user' } } as Session;

  it('keeps the cached session when auth returns no session', () => {
    expect(preserveSessionOnEmptyAuthResponse(cachedSession, null)).toBe(cachedSession);
  });

  it('uses a newly received session', () => {
    expect(preserveSessionOnEmptyAuthResponse(cachedSession, refreshedSession)).toBe(refreshedSession);
  });

  it('leaves signed-out users without a session', () => {
    expect(preserveSessionOnEmptyAuthResponse(null, null)).toBeNull();
  });
});
