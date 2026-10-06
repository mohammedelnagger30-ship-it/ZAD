/**
 * Translation string catalogue (Arabic + English).
 *
 * This used to be wired to `i18next` / `react-i18next`, but neither package is
 * a dependency and no module ever imported this file, so it could not compile
 * and the whole `typecheck` gate was red. The UI hard-codes its Arabic labels
 * today, so the catalogue is kept here as plain data — no runtime dependency,
 * zero bundle cost, and it is there if i18n is ever wanted.
 */

export interface TranslationStrings {
  [key: string]: string;
}

export const ar = {
  app_name: 'Nour ZAD',
  home: 'الرئيسية',
  quran: 'القرآن',
  tasks: 'المهام',
  hadith: 'الحديث',
  settings: 'الإعدادات',
  prayer_times: 'مواقيت الصلاة',
  today_tasks: 'مهام اليوم',
  streak: 'سلسلة الإنجاز',
  days: 'أيام',
  done: 'تم',
  missed: 'فات',
  snooze: 'تأجيل',
  backup: 'النسخ الاحتياطي',
  export: 'تصدير',
  import: 'استيراد',
  about: 'عن التطبيق',
  theme: 'المظهر',
  light: 'فاتح',
  dark: 'داكن',
  system: 'تلقائي',
  notifications: 'الإشعارات',
  sound_enabled: 'تفعيل الصوت',
  adhan_sound: 'صوت الأذان للصلاة',
  snooze_minutes: 'مدة التأجيل (دقائق)',
  pre_prayer_reminder: 'تذكير قبل الصلاة (دقائق)',
  off: 'إيقاف',
  calc_method: 'طريقة الحساب',
  asr_madhab: 'مذهب العصر',
  shafii: 'الشافعي (الجمهور)',
  hanafi: 'الحنفي',
  current_location: 'الموقع الحالي',
  not_set: 'غير محدد',
  font_size: 'حجم خط القرآن',
  small: 'صغير',
  large: 'كبير',
  search: 'بحث',
  bookmarks: 'العلامات المرجعية',
  no_tasks: 'لا توجد مهام لهذا اليوم',
  confirm: 'تأكيد',
  cancel: 'إلغاء',
} satisfies TranslationStrings;

export const en = {
  app_name: 'Nour ZAD',
  home: 'Home',
  quran: 'Quran',
  tasks: 'Tasks',
  hadith: 'Hadith',
  settings: 'Settings',
  prayer_times: 'Prayer Times',
  today_tasks: "Today's Tasks",
  streak: 'Streak',
  days: 'days',
  done: 'Done',
  missed: 'Missed',
  snooze: 'Snooze',
  backup: 'Backup',
  export: 'Export',
  import: 'Import',
  about: 'About',
  theme: 'Theme',
  light: 'Light',
  dark: 'Dark',
  system: 'System',
  notifications: 'Notifications',
  sound_enabled: 'Enable Sound',
  adhan_sound: 'Adhan Sound for Prayer',
  snooze_minutes: 'Snooze Duration (minutes)',
  pre_prayer_reminder: 'Pre-Prayer Reminder (minutes)',
  off: 'Off',
  calc_method: 'Calculation Method',
  asr_madhab: 'Asr Madhab',
  shafii: 'Shafii (Standard)',
  hanafi: 'Hanafi',
  current_location: 'Current Location',
  not_set: 'Not Set',
  font_size: 'Quran Font Size',
  small: 'Small',
  large: 'Large',
  search: 'Search',
  bookmarks: 'Bookmarks',
  no_tasks: 'No tasks for today',
  confirm: 'Confirm',
  cancel: 'Cancel',
} satisfies TranslationStrings;

export type Locale = 'ar' | 'en';

export const resources: Record<Locale, { translation: TranslationStrings }> = {
  ar: { translation: ar },
  en: { translation: en },
};

export const DEFAULT_LOCALE: Locale = 'ar';

export function translate(locale: Locale, key: keyof typeof ar): string {
  return resources[locale]?.translation[key] ?? resources[DEFAULT_LOCALE].translation[key] ?? key;
}
