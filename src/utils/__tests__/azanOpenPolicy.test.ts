/**
 * The freshness rules behind every automatic opening of the adhan/iqamah page.
 *
 * Each one answers a complaint that had a single cause: a claim about "now" standing
 * over a moment that had already passed. The tests below pin the two sides of each
 * window — what still opens, and what is refused — plus the boundaries themselves, so a
 * later tweak cannot quietly turn a guard into a no-op (or into a page that never opens).
 */
import {
  NATIVE_OPEN_MAX_LATE_MS,
  STALE_AZAN_CLOSE_MS,
  isDeliveredAlertFor,
  isNativeOpenFresh,
  isStaleAzanOpen,
} from '@/utils/azanOpenPolicy';
import { NOTIFICATION_ID_BASE, notificationId } from '@/utils/notifications';

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);

/** An ISO instant `offsetMs` away from the fixed "now" of these tests. */
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('isNativeOpenFresh — may a native alert open the page by itself?', () => {
  it('uses a quarter of an hour, the same line the native receiver draws', () => {
    // The number is mirrored on both sides of the bridge: the receiver's
    // `MISFIRED_AFTER_MS` and this one. If they drift apart, an alarm the platform
    // delivered late can still raise a page claiming «الآن» — or a page the platform
    // considered on time can be refused here. Fifteen minutes, on both sides.
    expect(NATIVE_OPEN_MAX_LATE_MS).toBe(15 * 60_000);
  });

  it('accepts the instant itself and a slow cold start', () => {
    expect(isNativeOpenFresh(iso(0), NOW)).toBe(true);
    expect(isNativeOpenFresh(iso(-5 * 60_000), NOW)).toBe(true);
  });

  it('accepts exactly the grace boundary', () => {
    expect(isNativeOpenFresh(iso(-NATIVE_OPEN_MAX_LATE_MS), NOW)).toBe(true);
  });

  it('refuses anything past the grace — the Dhuhr page raised at Asr', () => {
    expect(isNativeOpenFresh(iso(-NATIVE_OPEN_MAX_LATE_MS - 1), NOW)).toBe(false);
    expect(isNativeOpenFresh(iso(-3 * 60 * 60_000), NOW)).toBe(false);
  });

  it('refuses the twenty-minute alarm — the one that used to raise a wrong page', () => {
    // The reported case: a phone that only woke up twenty minutes late opened the
    // wrong prayer's page. Past the window the native receiver posts the «تأخّر
    // التنبيه» notice instead, and this side must agree with it.
    expect(isNativeOpenFresh(iso(-20 * 60_000), NOW)).toBe(false);
  });

  it('treats a missing or unreadable instant as fresh, so older builds keep working', () => {
    expect(isNativeOpenFresh(undefined, NOW)).toBe(true);
    expect(isNativeOpenFresh('not-a-date', NOW)).toBe(true);
  });
});

describe('isStaleAzanOpen — must a page already on screen close itself?', () => {
  const open = (prayerTime?: Date, isPreview = false) => ({
    isOpen: true,
    isPreview,
    prayerTime,
  });

  it('holds a page open over its own instant and the window after it', () => {
    expect(isStaleAzanOpen(open(new Date(NOW)), NOW)).toBe(false);
    expect(isStaleAzanOpen(open(new Date(NOW - STALE_AZAN_CLOSE_MS)), NOW)).toBe(false);
  });

  it('closes a page that has outlived the window', () => {
    expect(isStaleAzanOpen(open(new Date(NOW - STALE_AZAN_CLOSE_MS - 1)), NOW)).toBe(true);
  });

  it('never judges a closed page or a preview', () => {
    expect(
      isStaleAzanOpen({ isOpen: false, prayerTime: new Date(NOW - 10 * 60 * 60_000) }, NOW),
    ).toBe(false);
    expect(isStaleAzanOpen(open(new Date(NOW - 10 * 60 * 60_000), true), NOW)).toBe(false);
  });

  it('has nothing to judge when the open carries no usable instant', () => {
    expect(isStaleAzanOpen(open(undefined), NOW)).toBe(false);
    expect(isStaleAzanOpen(open(new Date(Number.NaN)), NOW)).toBe(false);
  });
});

describe('isDeliveredAlertFor — is this prayer actually ringing right now?', () => {
  const name = 'الظهر';

  it('recognises the takeover card and the plugin fallback alike', () => {
    // The takeover receiver builds `حان وقت الظهر`, the plugin fallback the same shape;
    // for the جماعة it is `حان وقت إقامة الظهر`.
    expect(
      isDeliveredAlertFor(
        { id: notificationId.prayer(3), title: `حان وقت ${name}` },
        NOTIFICATION_ID_BASE.prayer,
        name,
      ),
    ).toBe(true);
    expect(
      isDeliveredAlertFor(
        { id: notificationId.iqamah(3), title: `حان وقت إقامة ${name}` },
        NOTIFICATION_ID_BASE.iqamah,
        name,
      ),
    ).toBe(true);
  });

  it('does not mistake another category for this prayer’s card', () => {
    // An in-range id is not enough on its own: the same slot exists in every category.
    expect(
      isDeliveredAlertFor(
        { id: notificationId.dhikr(3), title: `حان وقت ${name}` },
        NOTIFICATION_ID_BASE.prayer,
        name,
      ),
    ).toBe(false);
    expect(
      isDeliveredAlertFor(
        { id: NOTIFICATION_ID_BASE.prayer - 1, title: `حان وقت ${name}` },
        NOTIFICATION_ID_BASE.prayer,
        name,
      ),
    ).toBe(false);
    expect(
      isDeliveredAlertFor(
        { id: NOTIFICATION_ID_BASE.prayer + 1_000_000, title: `حان وقت ${name}` },
        NOTIFICATION_ID_BASE.prayer,
        name,
      ),
    ).toBe(false);
  });

  it('does not mistake another prayer’s card for this one', () => {
    expect(
      isDeliveredAlertFor(
        { id: notificationId.prayer(3), title: 'حان وقت المغرب' },
        NOTIFICATION_ID_BASE.prayer,
        name,
      ),
    ).toBe(false);
  });

  it('treats a card with no title as not matching', () => {
    expect(
      isDeliveredAlertFor({ id: notificationId.prayer(3) }, NOTIFICATION_ID_BASE.prayer, name),
    ).toBe(false);
    expect(
      isDeliveredAlertFor(
        { id: notificationId.prayer(3), title: null },
        NOTIFICATION_ID_BASE.prayer,
        name,
      ),
    ).toBe(false);
  });
});
