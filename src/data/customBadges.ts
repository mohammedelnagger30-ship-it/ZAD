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

export const DEFAULT_BADGES: CustomBadge[] = [
  {
    id: 'first-day',
    name: 'بداية موفقة',
    emoji: '🌟',
    description: 'أول يوم من الالتزام',
    shareable: true,
  },
  {
    id: 'week-streak',
    name: 'أسبوع متواصل',
    emoji: '🔥',
    description: '7 أيام متتالية',
    shareable: true,
  },
  {
    id: 'month-streak',
    name: 'شهر الإلتزام',
    emoji: '💎',
    description: '30 يوم متتالية',
    shareable: true,
  },
  {
    id: 'small-hafiz',
    name: 'حافظ صغير',
    emoji: '📖',
    description: 'حفظت 10 آيات',
    shareable: true,
  },
  {
    id: 'dedicated-hafiz',
    name: 'حافظ مجتهد',
    emoji: '🏆',
    description: 'حفظت 100 آية',
    shareable: true,
  },
  {
    id: 'expert-hafiz',
    name: 'حافظ متقن',
    emoji: '👑',
    description: 'حفظت 500 آية',
    shareable: true,
  },
  {
    id: 'persistent',
    name: 'مثابر',
    emoji: '💪',
    description: 'أكملت 50 مهمة',
    shareable: true,
  },
  {
    id: 'prayer-champion',
    name: 'بطل الصلاة',
    emoji: '🕌',
    description: 'صليت 100 صلاة في وقتها',
    shareable: true,
  },
  {
    id: 'dhikr-lover',
    name: 'محب الذكر',
    emoji: '🤲',
    description: 'أتممت أذكار يوم 10 مرات',
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
