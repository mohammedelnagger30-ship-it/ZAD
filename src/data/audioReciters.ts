export interface AudioReciter {
  id: string;
  name: string;
}

/** Arabic recitations and narration styles available from Quran.com. */
export const AUDIO_RECITERS: AudioReciter[] = [
  { id: '97', name: 'ياسر الدوسري' },
  { id: '7', name: 'مشاري العفاسي — مرتل' },
  { id: '3', name: 'عبدالرحمن السديس' },
  { id: '6', name: 'محمود خليل الحصري — مرتل' },
  { id: '12', name: 'محمود خليل الحصري — معلم' },
  { id: '4', name: 'أبو بكر الشاطري' },
  { id: '5', name: 'هاني الرفاعي' },
  { id: '9', name: 'محمد صديق المنشاوي — مرتل' },
  { id: '10', name: 'سعود الشريم' },
  { id: '1', name: 'عبد الباسط عبد الصمد — مجود' },
  { id: '2', name: 'عبد الباسط عبد الصمد — مرتل' },
];

export const DEFAULT_RECITER_ID = AUDIO_RECITERS[0].id;
export const RECITER_STORAGE_KEY = 'hifzi-audio-reciter';

export function loadPreferredReciter(): string {
  const stored = localStorage.getItem(RECITER_STORAGE_KEY);
  return AUDIO_RECITERS.some((reciter) => reciter.id === stored) ? stored! : DEFAULT_RECITER_ID;
}

export function savePreferredReciter(reciterId: string): void {
  localStorage.setItem(RECITER_STORAGE_KEY, reciterId);
}
