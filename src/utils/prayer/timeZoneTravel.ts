/**
 * Keep an automatically selected Egyptian location current.
 *
 * Prayer times stay on Egypt's calculation and Cairo timezone. A device timezone
 * change may refresh an automatic location only when its permitted GPS fix remains
 * inside Egypt; travel outside the supported scope leaves the saved location intact.
 *
 * Adoption is deliberately conservative:
 *   - use a real GPS fix only when its permission was already granted;
 *   - otherwise use an Egyptian preset matching the device zone;
 *   - never move a pinned city or adopt coordinates outside Egypt.
 *
 * A city the reader pinned on purpose (the displayed zone no longer matches
 * where the device was) is never moved; trips just record where the phone has
 * been, so the baseline is ready if they later choose to follow it again.
 *
 * Device-zone tracking throttles GPS refreshes to actual device-zone changes;
 * the foreground refresher also updates the saved fix periodically.
 */
import type { Settings } from '@/db/database';
import { CITY_PRESETS, getPrayerTimeZone, isEgyptianLocation } from './prayerTimes';

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
  settings: Pick<Settings, 'timeZone' | 'cityName' | 'locationMethod'>,
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

  if (
    settings.locationMethod === 'auto' &&
    followsPreviousZone(settings, previousDeviceZone)
  ) {
    const fix = await io.position();
    const patch: (Partial<Settings> & { cityName: string }) | null = fix && isEgyptianLocation(
      fix.latitude,
      fix.longitude,
    )
      ? {
          cityName: 'موقعي داخل مصر',
          latitude: fix.latitude,
          longitude: fix.longitude,
          timeZone: 'Africa/Cairo',
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
