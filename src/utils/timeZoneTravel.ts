/**
 * Travel between timezones.
 *
 * The reader moves — a flight, a border, a SIM waking up in another country — and
 * the app must follow without being asked: prayer times for where the phone now
 * stands, with that zone's own summer/winter rules. Those rules need no branch of
 * their own: the IANA name carries them, and the platform's ICU applies them to
 * each date (an October transition included).
 *
 * Adoption is deliberately conservative about *what* may follow the zone:
 *   - a real GPS fix, when permission for one was already granted — never a
 *     permission dialog opened unasked;
 *   - failing that, a preset city whose timezone is the device's — coordinates
 *     and all, labelled as that city;
 *   - failing that, nothing — moving only the zone would wear a new clock on old
 *     coordinates and call it a new place.
 *
 * A city the reader pinned on purpose (the displayed zone no longer matches
 * where the device was) is never moved; trips just record where the phone has
 * been, so the baseline is ready if they later choose to follow it again.
 *
 * The zone the device reports is tracked across checks rather than compared to
 * the settings: settings express *intent* (a pinned city must survive travel),
 * the tracked zone expresses *movement* (only a change of it is a trip).
 */
import type { Settings } from '@/db/database';
import { CITY_PRESETS, getPrayerTimeZone } from './prayerTimes';

/** The zone the device last reported, so a change in it can be noticed. */
const LAST_DEVICE_TIME_ZONE_KEY = 'zad:last-device-tz';

/** Raised after the app moves itself, with the adopted city/position label. */
export const TIME_ZONE_ADOPTION_EVENT = 'zad:time-zone-adoption';

/** The zone the platform itself reports — the phone's present-tense claim. */
export function readDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function readLastDeviceTimeZone(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_DEVICE_TIME_ZONE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeLastDeviceTimeZone(timeZone: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_DEVICE_TIME_ZONE_KEY, timeZone);
  } catch {
    // Storage unavailable (private mode): the next launch re-baselines instead.
  }
}

/** True while the app displays times for where the device was — i.e. it follows. */
export function followsPreviousZone(
  settings: Pick<Settings, 'timeZone' | 'cityName'>,
  previousDeviceZone: string,
): boolean {
  return getPrayerTimeZone(settings.timeZone, settings.cityName) === previousDeviceZone;
}

/**
 * A position for the new zone when one is already permitted, otherwise null.
 * Asked only when the phone crosses into a different zone, and only ever
 * answered — never asked on the reader's behalf; a dialog on app open is not
 * what "adjusts automatically" means.
 */
export async function currentDevicePosition(): Promise<{ latitude: number; longitude: number } | null> {
  const geolocation = globalThis.navigator?.geolocation;
  if (!geolocation) return null;

  try {
    const permission = await globalThis.navigator?.permissions?.query({ name: 'geolocation' });
    if (permission?.state !== 'granted') return null;
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve(null),
      { timeout: 15_000, maximumAge: 600_000, enableHighAccuracy: false },
    );
  });
}

/** The preset whose timezone is exactly the device's, moved wholesale. */
function presetAdoption(deviceZone: string): (Partial<Settings> & { cityName: string }) | null {
  const preset = CITY_PRESETS.find((city) => city.timeZone === deviceZone);
  if (!preset) return null;
  return {
    cityName: preset.name,
    latitude: preset.latitude,
    longitude: preset.longitude,
    timeZone: preset.timeZone,
    locationMethod: 'manual',
  };
}

export interface TimeZoneAdoptionIO {
  /** A permitted GPS fix for the device's position, or null. */
  position: () => Promise<{ latitude: number; longitude: number } | null>;
  /** Persist the settings patch (the caller's own save path). */
  save: (patch: Partial<Settings>) => Promise<void>;
  /** Record the zone the device now reports as the new baseline. */
  writePreviousZone: (zone: string) => void;
  /** Announce an adoption so the UI can say what changed. */
  notify: (cityName: string) => void;
}

/**
 * Move the app across a timezone boundary. Returns the adopted label, or null
 * when nothing moved — first baseline, unchanged zone, a pinned city, or no
 * usable location. In every no-change case the new zone is still recorded, so
 * the decision is made once per trip instead of re-litigated at every check.
 * A rejected save propagates without recording: the trip is retried instead of
 * silently swallowed.
 */
export async function adoptDeviceTimeZone(
  settings: Pick<Settings, 'timeZone' | 'cityName'>,
  previousDeviceZone: string | null,
  deviceZone: string,
  io: TimeZoneAdoptionIO,
): Promise<string | null> {
  if (previousDeviceZone === null) {
    // First run of this logic: adopt the present as the baseline without
    // touching settings — an upgrade must not rewrite an existing choice.
    io.writePreviousZone(deviceZone);
    return null;
  }
  if (deviceZone === previousDeviceZone) return null;

  if (followsPreviousZone(settings, previousDeviceZone)) {
    const fix = await io.position();
    const patch: (Partial<Settings> & { cityName: string }) | null = fix
      ? {
          cityName: 'موقعي الحالي',
          latitude: fix.latitude,
          longitude: fix.longitude,
          timeZone: deviceZone,
          locationMethod: 'auto',
        }
      : presetAdoption(deviceZone);

    if (patch) {
      await io.save(patch);
      io.writePreviousZone(deviceZone);
      io.notify(patch.cityName);
      return patch.cityName;
    }
  }

  io.writePreviousZone(deviceZone);
  return null;
}

export function notifyTimeZoneAdoption(cityName: string): void {
  window.dispatchEvent(new CustomEvent(TIME_ZONE_ADOPTION_EVENT, { detail: cityName }));
}
