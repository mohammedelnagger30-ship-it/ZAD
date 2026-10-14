/**
 * Custom badges system with emoji support and sharing capability
 */

export interface CustomBadge {
  id: string;
  name: string;
  emoji: string;
  description: string;
  unlockedAt?: number;
  shareable: boolean;
}

/**
 * The catalogue, and behind it what each badge asks for.
 *
 * The `description` is what a locked badge shows as its goal, so it has to
 * say the same thing the threshold says — «أول يوم من الالتزام» sat under a
 * badge that needed three days, and while nothing drew it that contradiction
 * was harmless. Numerals are Arabic-Indic because this is now text the
 * screen renders, beside counts the screen renders with `toArabicNumber`.
 */
export const DEFAULT_BADGES: CustomBadge[] = [
  {
    id: 'first-day',
    name: 'بداية موفقة',
    emoji: '🌟',
    description: '٣ أيام متتالية',
    shareable: true,
  },
  {
    id: 'week-streak',
    name: 'أسبوع متواصل',
    emoji: '🔥',
    description: '٧ أيام متتالية',
    shareable: true,
  },
  {
    id: 'month-streak',
    name: 'شهر الإلتزام',
    emoji: '💎',
    description: '٣٠ يومًا متتاليًا',
    shareable: true,
  },
  {
    id: 'small-hafiz',
    name: 'حافظ صغير',
    emoji: '📖',
    description: 'حفظت ١٠ آيات',
    shareable: true,
  },
  {
    id: 'dedicated-hafiz',
    name: 'حافظ مجتهد',
    emoji: '🏆',
    description: 'حفظت ١٠٠ آية',
    shareable: true,
  },
  {
    id: 'expert-hafiz',
    name: 'حافظ متقن',
    emoji: '👑',
    description: 'حفظت ٥٠٠ آية',
    shareable: true,
  },
  {
    id: 'persistent',
    name: 'مثابر',
    emoji: '💪',
    description: 'أكملت ٥٠ مهمة',
    shareable: true,
  },
  {
    id: 'prayer-champion',
    name: 'بطل الصلاة',
    emoji: '🕌',
    description: 'صليت ١٠٠ صلاة في وقتها',
    shareable: true,
  },
  {
    id: 'dhikr-lover',
    name: 'محب الذكر',
    emoji: '🤲',
    description: 'أتممت أذكار ١٠ أيام',
    shareable: true,
  },
  {
    id: 'khatmah-hero',
    name: 'بطل الختمة',
    emoji: '🎯',
    description: 'أتممت ختمة كاملة',
    shareable: true,
  },
];

export function getBadgeById(id: string): CustomBadge | undefined {
  return DEFAULT_BADGES.find((badge) => badge.id === id);
}

export function getAllBadges(): CustomBadge[] {
  return DEFAULT_BADGES;
}

export function generateShareText(badge: CustomBadge): string {
  return `🏆 حصلت على وسام "${badge.name}" ${badge.emoji} في تطبيق قُرّة!\n\n${badge.description}\n\n#قُرّة #القرآن #الصلاة`;
}

export function shareBadge(badge: CustomBadge): Promise<void> {
  const shareText = generateShareText(badge);

  if (navigator.share) {
    return navigator.share({
      title: `وسام ${badge.name}`,
      text: shareText,
    });
  }

  // Fallback: copy to clipboard
  return navigator.clipboard.writeText(shareText).then(() => {
    // Could show a toast notification here
  });
}
