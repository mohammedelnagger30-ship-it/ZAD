import type { ReactNode } from 'react';

export function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h2 className="flex items-center gap-2 px-1 text-sm font-bold text-primary-900 dark:text-primary-100">
      <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-800 dark:text-gold-400">
        {icon}
      </span>
      {title}
    </h2>
  );
}
