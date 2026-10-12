/**
 * Pillars of Islam (Arkan al‑Deen) – data model
 * Each pillar contains an optional list of its core components (sub‑parts).
 * The structure is exported as a constant `PILLARS` for consumption in UI.
 */

type Pillar = {
  /** Arabic name */
  nameAr: string;
  /** English translation */
  nameEn: string;
  /** Short description of the pillar */
  description: string;
  /** Optional ordered list of sub‑parts (e.g., the five pillars have specific duties) */
  parts?: Array<{
    /** Arabic name of the part */
    nameAr: string;
    /** English translation */
    nameEn: string;
    /** Brief description */
    description: string;
  }>;
};

export const PILLARS: Pillar[] = [
  {
    nameAr: 'الشهادة (الشهادة بأن لا إله إلا الله وأن محمدًا رسول الله)',
    nameEn: 'Shahada (Testimony of Faith)',
    description: 'الإقرار بأن لا إله إلا الله وأن محمدًا رسوله هو أساس الدين.',
    parts: [
      {
        nameAr: 'لا إله إلا الله',
        nameEn: 'There is no deity but Allah',
        description: 'التوحيد، إقرار أن الله هو الإله الواحد.',
      },
      {
        nameAr: 'أن محمدًا رسول الله',
        nameEn: 'Muhammad is the messenger of Allah',
        description: 'الإقرار بنبوة محمد ﷺ والاعتراف به كخاتم النبيين.',
      },
    ],
  },
  {
    nameAr: 'الصلاة',
    nameEn: 'Salah (Prayer)',
    description: 'إقامة الصلوات الخمس المفروضة على كل مسلم بالغ عاقل.',
    parts: [
      { nameAr: 'الفجر', nameEn: 'Fajr', description: 'صلاة الفجر تتكون من ركعتين.' },
      { nameAr: 'الظهر', nameEn: 'Dhuhr', description: 'صلاة الظهر تتكون من أربع ركعات.' },
      { nameAr: 'العصر', nameEn: 'Asr', description: 'صلاة العصر تتكون من أربع ركعات.' },
      { nameAr: 'المغرب', nameEn: 'Maghrib', description: 'صلاة المغرب تتكون من ثلاث ركعات.' },
      { nameAr: 'العشاء', nameEn: 'Isha', description: 'صلاة العشاء تتكون من أربع ركعات.' },
    ],
  },
  {
    nameAr: 'الزكاة',
    nameEn: 'Zakat (Almsgiving)',
    description: 'دفع نسبة محددة من المال للفقراء والمحتاجين كل سنة هجريّة.',
  },
  {
    nameAr: 'الصوم',
    nameEn: 'Sawm (Fasting)',
    description: 'صوم شهر رمضان من الفجر حتى المغرب، مع استثناؤه لأعذار مشروعة.',
  },
  {
    nameAr: 'الحج',
    nameEn: 'Hajj (Pilgrimage)',
    description: 'الأداء مرة واحدة على الأقل في العمر لمن استطاع إليه سبيلاً.',
    parts: [
      { nameAr: 'الإحرام', nameEn: 'Ihram', description: 'النية واللباس الخاص بالحج.' },
      { nameAr: 'الطواف', nameEn: 'Tawaf', description: 'الطواف حول الكعبة.' },
      { nameAr: 'السعي', nameEn: 'Sa’i', description: 'السعي بين الصفا والمروة.' },
      { nameAr: 'المقصد', nameEn: 'Maqam', description: 'الوقوف في عرفات.' },
    ],
  },
];
