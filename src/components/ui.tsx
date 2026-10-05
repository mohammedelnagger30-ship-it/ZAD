import type { KeyboardEvent, ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  noPadding?: boolean;
}

/**
 * Surface container. When it is clickable it must also behave like a button, otherwise
 * every card in the app is invisible to the keyboard and to screen readers — a
 * `cursor-pointer` div has neither focus nor an accessible role.
 */
export function Card({ children, className = '', onClick, noPadding }: CardProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    // Enter and Space are the two keys a native <button> would respond to. Space must
    // be prevented or the page scrolls instead of activating the card.
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      onClick={onClick}
      onKeyDown={onClick ? handleKeyDown : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`
        bg-white dark:bg-primary-900/40
        rounded-2xl shadow-sm
        border border-primary-100 dark:border-primary-800/40
        transition-smooth
        ${onClick ? 'cursor-pointer hover:shadow-md hover:border-primary-300 dark:hover:border-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400' : ''}
        ${noPadding ? '' : 'p-4'}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function SectionHeader({ title, icon, action }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {icon && <span className="text-primary-600 dark:text-gold-400">{icon}</span>}
        <h2 className="text-lg font-bold text-primary-800 dark:text-primary-100">{title}</h2>
      </div>
      {action}
    </div>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'gold' | 'ghost' | 'success' | 'error' | 'warning';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  disabled?: boolean;
  className?: string;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  fullWidth,
  disabled,
  className = '',
}: ButtonProps) {
  const variants: Record<string, string> = {
    primary: 'bg-primary-600 hover:bg-primary-700 text-white shadow-sm',
    secondary: 'bg-primary-100 hover:bg-primary-200 dark:bg-primary-800 dark:hover:bg-primary-700 text-primary-700 dark:text-primary-100',
    gold: 'bg-gold-500 hover:bg-gold-600 text-white shadow-sm',
    ghost: 'hover:bg-primary-50 dark:hover:bg-primary-800/40 text-primary-700 dark:text-primary-200',
    success: 'bg-success-500 hover:bg-success-600 text-white shadow-sm',
    error: 'bg-error-500 hover:bg-error-600 text-white shadow-sm',
    warning: 'bg-warning-500 hover:bg-warning-600 text-white shadow-sm',
  };
  const sizes: Record<string, string> = {
    sm: 'px-3 py-1.5 text-sm rounded-lg',
    md: 'px-4 py-2.5 text-base rounded-xl',
    lg: 'px-6 py-3 text-lg rounded-xl',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        font-medium transition-smooth active:scale-95
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]} ${sizes[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
    >
      {children}
    </button>
  );
}

export interface BadgeProps {
  children: ReactNode;
  variant?: 'primary' | 'gold' | 'success' | 'warning' | 'error' | 'neutral';
}

export function Badge({ children, variant = 'primary' }: BadgeProps) {
  const variants: Record<string, string> = {
    primary: 'bg-primary-100 text-primary-700 dark:bg-primary-800/60 dark:text-primary-200',
    gold: 'bg-gold-100 text-gold-700 dark:bg-gold-900/50 dark:text-gold-300',
    success: 'bg-success-100 text-success-700 dark:bg-success-900/50 dark:text-success-300',
    warning: 'bg-warning-100 text-warning-700 dark:bg-warning-900/50 dark:text-warning-300',
    error: 'bg-error-100 text-error-700 dark:bg-error-900/50 dark:text-error-300',
    neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${variants[variant]}`}>
      {children}
    </span>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** A ready-made control, e.g. a button that opens the library. */
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center animate-fade-in">
      {icon && <div className="text-primary-300 dark:text-primary-700 mb-4">{icon}</div>}
      <h3 className="text-lg font-semibold text-primary-700 dark:text-primary-200 mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-xs">{description}</p>}
      {action}
    </div>
  );
}
