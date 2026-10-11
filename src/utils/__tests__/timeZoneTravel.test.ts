/**
 * Travel across timezone boundaries.
 *
 * The contract under test: a zone change moves the app only when it still
 * follows the phone — by a permitted GPS fix, else by the preset that owns the
 * zone — never moves a city pinned deliberately, records the new zone either
 * way so a trip is decided once, and refuses to lose a trip whose save failed.
 */
import { jest } from '@jest/globals';
import type { Settings } from '@/db/database';
import {
  adoptDeviceTimeZone,
  followsPreviousZone,
  notifyTimeZoneAdoption,
  readDeviceTimeZone,
  readLastDeviceTimeZone,
  writeLastDeviceTimeZone,
  TIME_ZONE_ADOPTION_EVENT,
  type TimeZoneAdoptionIO,
} from '@/utils/timeZoneTravel';

type Fix = { latitude: number; longitude: number };

interface IOOverrides {
  position?: () => Promise<Fix | null>;
  save?: (patch: Partial<Settings>) => Promise<void>;
}

function makeIO(overrides: IOOverrides = {}): TimeZoneAdoptionIO {
  const noPosition = async (): Promise<Fix | null> => null;
  const saveQuietly = async (_patch: Partial<Settings>): Promise<void> => {};
  return {
    position: jest.fn(overrides.position ?? noPosition),
    save: jest.fn(overrides.save ?? saveQuietly),
    writePreviousZone: jest.fn(),
    notify: jest.fn(),
  };
}

const cairoSettings = { timeZone: 'Africa/Cairo', cityName: 'القاهرة' };

describe('followsPreviousZone', () => {
  it('is true while the displayed zone is the device’s old zone', () => {
    expect(followsPreviousZone(cairoSettings, 'Africa/Cairo')).toBe(true);
  });

  it('is false once the displayed zone diverges from where the device was', () => {
    // A reader in London who pinned القاهرة: the app no longer follows the phone.
    expect(followsPreviousZone(cairoSettings, 'Europe/London')).toBe(false);
  });
});

describe('adoptDeviceTimeZone', () => {
  it('baselines on the first run without touching settings', async () => {
    const io = makeIO();
    const result = await adoptDeviceTimeZone(cairoSettings, null, 'Africa/Cairo', io);
    expect(result).toBeNull();
    expect(io.writePreviousZone).toHaveBeenCalledWith('Africa/Cairo');
    expect(io.save).not.toHaveBeenCalled();
  });

  it('does nothing when the zone has not changed', async () => {
    const io = makeIO();
    const result = await adoptDeviceTimeZone(cairoSettings, 'Africa/Cairo', 'Africa/Cairo', io);
    expect(result).toBeNull();
    expect(io.writePreviousZone).not.toHaveBeenCalled();
    expect(io.save).not.toHaveBeenCalled();
  });

  it('never moves a city pinned off the device zone, but keeps recording trips', async () => {
    const io = makeIO();
    const result = await adoptDeviceTimeZone(cairoSettings, 'Europe/London', 'Asia/Riyadh', io);
    expect(result).toBeNull();
    expect(io.save).not.toHaveBeenCalled();
    expect(io.writePreviousZone).toHaveBeenCalledWith('Asia/Riyadh');
  });

  it('adopts a permitted GPS fix as the current position in the new zone', async () => {
    const io = makeIO({ position: async () => ({ latitude: 51.5074, longitude: -0.1278 }) });
    const result = await adoptDeviceTimeZone(cairoSettings, 'Africa/Cairo', 'Europe/London', io);
    expect(result).toBe('موقعي الحالي');
    expect(io.save).toHaveBeenCalledWith({
      cityName: 'موقعي الحالي',
      latitude: 51.5074,
      longitude: -0.1278,
      timeZone: 'Europe/London',
      locationMethod: 'auto',
    });
    expect(io.writePreviousZone).toHaveBeenCalledWith('Europe/London');
    expect(io.notify).toHaveBeenCalledWith('موقعي الحالي');
  });

  it('falls back to the preset owning the zone when no fix is permitted', async () => {
    const io = makeIO(); // position: null (permission not granted)
    const result = await adoptDeviceTimeZone(cairoSettings, 'Africa/Cairo', 'Europe/London', io);
    expect(result).toBe('لندن');
    expect(io.save).toHaveBeenCalledWith({
      cityName: 'لندن',
      latitude: 51.5074,
      longitude: -0.1278,
      timeZone: 'Europe/London',
      locationMethod: 'manual',
    });
    expect(io.notify).toHaveBeenCalledWith('لندن');
    expect(io.writePreviousZone).toHaveBeenCalledWith('Europe/London');
  });

  it('moves nothing when the zone has no preset and no fix — only records the trip', async () => {
    const io = makeIO();
    const result = await adoptDeviceTimeZone(cairoSettings, 'Africa/Cairo', 'Atlantic/Azores', io);
    expect(result).toBeNull();
    expect(io.save).not.toHaveBeenCalled();
    expect(io.writePreviousZone).toHaveBeenCalledWith('Atlantic/Azores');
  });

  it('keeps the old baseline when the save fails, so the trip is retried', async () => {
    const io = makeIO({
      save: async () => {
        throw new Error('disk full');
      },
    });
    await expect(
      adoptDeviceTimeZone(cairoSettings, 'Africa/Cairo', 'Europe/London', io),
    ).rejects.toThrow('disk full');
    expect(io.writePreviousZone).not.toHaveBeenCalled();
    expect(io.notify).not.toHaveBeenCalled();
  });
});

describe('zone bookkeeping', () => {
  beforeEach(() => {
    localStorage.removeItem('zad:last-device-tz');
  });

  it('round-trips the last device zone through storage', () => {
    expect(readLastDeviceTimeZone()).toBeNull();
    writeLastDeviceTimeZone('Europe/London');
    expect(readLastDeviceTimeZone()).toBe('Europe/London');
  });

  it('reports the platform zone as a non-empty string', () => {
    expect(readDeviceTimeZone()).toEqual(expect.any(String));
    expect(readDeviceTimeZone().length).toBeGreaterThan(0);
  });

  it('announces an adoption with the label it moved to', () => {
    const seen: string[] = [];
    const onAdopted = (event: Event) => seen.push((event as CustomEvent<string>).detail);
    window.addEventListener(TIME_ZONE_ADOPTION_EVENT, onAdopted);
    notifyTimeZoneAdoption('لندن');
    window.removeEventListener(TIME_ZONE_ADOPTION_EVENT, onAdopted);
    expect(seen).toEqual(['لندن']);
  });
});
