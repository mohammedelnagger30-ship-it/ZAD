/**
 * Automatic prayer locations stay within Egypt across device-zone changes.
 *
 * The contract under test: only an already-permitted Egyptian GPS fix may update
 * automatic coordinates; foreign fixes and presets leave the cached place intact.
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

const cairoSettings = {
  timeZone: 'Africa/Cairo',
  cityName: 'القاهرة',
  locationMethod: 'auto' as const,
};

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

  it('does not move a manually selected Egyptian city', async () => {
    const io = makeIO({
      position: async () => ({ latitude: 31.2001, longitude: 29.9187 }),
    });
    const result = await adoptDeviceTimeZone(
      { ...cairoSettings, locationMethod: 'manual' },
      'Africa/Cairo',
      'Europe/London',
      io,
    );
    expect(result).toBeNull();
    expect(io.save).not.toHaveBeenCalled();
    expect(io.writePreviousZone).toHaveBeenCalledWith('Europe/London');
  });

  it('adopts a permitted GPS fix only when it remains inside Egypt', async () => {
    const io = makeIO({ position: async () => ({ latitude: 30.0444, longitude: 31.2357 }) });
    const result = await adoptDeviceTimeZone(cairoSettings, 'Africa/Cairo', 'Europe/London', io);
    expect(result).toBe('موقعي داخل مصر');
    expect(io.save).toHaveBeenCalledWith({
      cityName: 'موقعي داخل مصر',
      latitude: 30.0444,
      longitude: 31.2357,
      timeZone: 'Africa/Cairo',
      locationMethod: 'auto',
    });
    expect(io.writePreviousZone).toHaveBeenCalledWith('Europe/London');
    expect(io.notify).toHaveBeenCalledWith('موقعي داخل مصر');
  });

  it('does not adopt a foreign GPS fix', async () => {
    const io = makeIO({ position: async () => ({ latitude: 51.5074, longitude: -0.1278 }) });
    const result = await adoptDeviceTimeZone(cairoSettings, 'Africa/Cairo', 'Europe/London', io);
    expect(result).toBeNull();
    expect(io.save).not.toHaveBeenCalled();
    expect(io.notify).not.toHaveBeenCalled();
    expect(io.writePreviousZone).toHaveBeenCalledWith('Europe/London');
  });

  it('does not fall back to a preset outside Egypt', async () => {
    const io = makeIO(); // position: null (permission not granted)
    const result = await adoptDeviceTimeZone(cairoSettings, 'Africa/Cairo', 'Europe/London', io);
    expect(result).toBeNull();
    expect(io.save).not.toHaveBeenCalled();
    expect(io.notify).not.toHaveBeenCalled();
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
      position: async () => ({ latitude: 30.0444, longitude: 31.2357 }),
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
    notifyTimeZoneAdoption('موقعي داخل مصر');
    window.removeEventListener(TIME_ZONE_ADOPTION_EVENT, onAdopted);
    expect(seen).toEqual(['موقعي داخل مصر']);
  });
});
