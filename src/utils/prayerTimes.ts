import {
  Coordinates,
  CalculationMethod,
  CalculationParameters,
  PrayerTimes,
  Qibla,
  Madhab,
} from 'adhan';

export interface PrayerTimeInfo {
  name: string;
  arabicName: string;
  time: Date;
  passed: boolean;
}

export interface PrayerTimesResult {
  prayers: PrayerTimeInfo[];
  qiblaDirection: number;
  date: Date;
}

export function getCalcMethod(method: string): CalculationParameters {
  switch (method) {
    case 'Egyptian': return CalculationMethod.Egyptian();
    case 'MWL': return CalculationMethod.MuslimWorldLeague();
    case 'Karachi': return CalculationMethod.Karachi();
    case 'UMM al-Qura': return CalculationMethod.UmmAlQura();
    case 'Dubai': return CalculationMethod.Dubai();
    case 'Moonsighting': return CalculationMethod.MoonsightingCommittee();
    case 'NorthAmerica': return CalculationMethod.NorthAmerica();
    case 'Kuwait': return CalculationMethod.Kuwait();
    case 'Qatar': return CalculationMethod.Qatar();
    case 'Singapore': return CalculationMethod.Singapore();
    case 'Turkey': return CalculationMethod.Turkey();
    case 'Tehran': return CalculationMethod.Tehran();
    default: return CalculationMethod.Egyptian();
  }
}

export function calculatePrayerTimes(
  latitude: number,
  longitude: number,
  date: Date,
  calcMethod: string,
  asrMadhab: 'standard' | 'hanafi'
): PrayerTimesResult {
  const coords = new Coordinates(latitude, longitude);
  const params = getCalcMethod(calcMethod);
  params.madhab = asrMadhab === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;

  const pt = new PrayerTimes(coords, date, params);
  const qiblaDirection = Qibla(coords);

  const now = new Date();
  const prayerTimes: { name: string; arabicName: string; time: Date }[] = [
    { name: 'fajr', arabicName: 'الفجر', time: pt.fajr },
    { name: 'sunrise', arabicName: 'الشروق', time: pt.sunrise },
    { name: 'dhuhr', arabicName: 'الظهر', time: pt.dhuhr },
    { name: 'asr', arabicName: 'العصر', time: pt.asr },
    { name: 'maghrib', arabicName: 'المغرب', time: pt.maghrib },
    { name: 'isha', arabicName: 'العشاء', time: pt.isha },
  ];

  const prayers: PrayerTimeInfo[] = prayerTimes.map((p) => ({
    ...p,
    passed: p.time < now,
  }));

  return { prayers, qiblaDirection, date };
}

export function getNextPrayer(
  latitude: number,
  longitude: number,
  calcMethod: string,
  asrMadhab: 'standard' | 'hanafi'
): PrayerTimeInfo | null {
  const now = new Date();
  const today = calculatePrayerTimes(latitude, longitude, now, calcMethod, asrMadhab);
  const upcoming = today.prayers.filter((p) => p.name !== 'sunrise' && p.time > now);
  if (upcoming.length > 0) {
    return upcoming[0];
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowTimes = calculatePrayerTimes(latitude, longitude, tomorrow, calcMethod, asrMadhab);
  return tomorrowTimes.prayers[0];
}

export function formatTime12h(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'م' : 'ص';
  hours = hours % 12 || 12;
  const minStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${minStr} ${ampm}`;
}

/**
 * Human-readable time left until `date`.
 *
 * `now` is injectable so callers that already re-render on a timer (e.g. HomeScreen)
 * stay in sync with a single clock instead of each call reading a fresh `Date()`.
 */
export function getTimeUntil(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime();
  if (diff <= 0) return 'انتهى';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) {
    return `بعد ${hours} ساعة و ${minutes} دقيقة`;
  }
  return `بعد ${minutes} دقيقة`;
}

export const CALC_METHODS = [
  'Egyptian',
  'MWL',
  'Karachi',
  'UMM al-Qura',
  'Dubai',
  'Moonsighting',
  'NorthAmerica',
  'Kuwait',
  'Qatar',
  'Singapore',
  'Turkey',
  'Tehran',
];

export const CALC_METHOD_NAMES_AR: Record<string, string> = {
  'Egyptian': 'الهيئة المصرية العامة للمساحة',
  'MWL': 'رابطة العالم الإسلامي',
  'Karachi': 'جامعة كراتشي',
  'UMM al-Qura': 'أم القرى',
  'Dubai': 'دبي',
  'Moonsighting': 'لجنة رؤية الهلال',
  'NorthAmerica': 'أمريكا الشمالية',
  'Kuwait': 'الكويت',
  'Qatar': 'قطر',
  'Singapore': 'سنغافورة',
  'Turkey': 'تركيا',
  'Tehran': 'طهران',
};

export interface CityPreset {
  name: string;
  latitude: number;
  longitude: number;
}

export const CITY_PRESETS: CityPreset[] = [
  { name: 'القاهرة', latitude: 30.0444, longitude: 31.2357 },
  { name: 'مكة المكرمة', latitude: 21.4225, longitude: 39.8262 },
  { name: 'المدينة المنورة', latitude: 24.5247, longitude: 39.5692 },
  { name: 'الرياض', latitude: 24.7136, longitude: 46.6753 },
  { name: 'الإسكندرية', latitude: 31.2001, longitude: 29.9187 },
  { name: 'بيروت', latitude: 33.8938, longitude: 35.5018 },
  { name: 'عمّان', latitude: 31.9454, longitude: 35.9284 },
  { name: 'بغداد', latitude: 33.3152, longitude: 44.3661 },
  { name: 'دمشق', latitude: 33.5138, longitude: 36.2765 },
  { name: 'الجزائر', latitude: 36.7538, longitude: 3.0588 },
  { name: 'تونس', latitude: 36.8065, longitude: 10.1815 },
  { name: 'الرباط', latitude: 34.0209, longitude: -6.8416 },
  { name: 'الدوحة', latitude: 25.2854, longitude: 51.531 },
  { name: 'الكويت', latitude: 29.3759, longitude: 47.9774 },
  { name: 'المنامة', latitude: 26.2285, longitude: 50.586 },
  { name: 'أبو ظبي', latitude: 24.4539, longitude: 54.3773 },
  { name: 'دبي', latitude: 25.2048, longitude: 55.2708 },
  { name: 'صنعاء', latitude: 15.3694, longitude: 44.191 },
  { name: 'الخرطوم', latitude: 15.5007, longitude: 32.5599 },
  { name: 'إسطنبول', latitude: 41.0082, longitude: 28.9784 },
];
