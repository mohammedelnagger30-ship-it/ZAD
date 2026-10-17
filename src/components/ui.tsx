import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

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
        bg-panel dark:bg-raised
        rounded-2xl shadow-sm
        border border-primary-100/80 dark:border-primary-800/60
        transition-smooth
        ${onClick
          ? 'cursor-pointer hover:shadow-md hover:border-primary-300 dark:hover:border-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400'
          : 'motion-safe:transition-all duration-200 hover:shadow-md hover:border-primary-200/80 dark:hover:border-primary-700/80'}
        ${noPadding ? '' : 'p-4 md:p-5'}
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
        <h2 className="text-lg md:text-xl font-bold text-primary-800 dark:text-primary-100">{title}</h2>
      </div>
      {/* The action arrives as a bare text link; grow the BUTTON itself to a
          finger-sized target. The negative margin keeps the header exactly where
          it was — the extra area lands in the gaps that already surround it. */}
      {action && <div className="flex items-center [&>button]:-my-2 [&>button]:py-2.5">{action}</div>}
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
  /** Inline override for the fill (e.g. the active palette's gradient). Wins over `variant`. */
  style?: CSSProperties;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  fullWidth,
  disabled,
  className = '',
  style,
}: ButtonProps) {
  const variants: Record<string, string> = {
    primary: 'bg-primary-600 hover:bg-primary-700 text-white shadow-sm',
    secondary: 'bg-primary-100 hover:bg-primary-200 dark:bg-primary-800 dark:hover:bg-primary-700 text-primary-700 dark:text-primary-100',
    // These four sit on bright fills — gold-500, success-500, warning-500,
    // error-500 — and white on them measures 2.38, 2.28, 2.15 and 3.76:1, all
    // under the 4.5:1 a label needs. Stepping a shade darker does not rescue
    // them either: -600 lands at 3.63/3.30/3.19, still short. So the fill stays
    // bright — it is the app's identity — and the text goes dark instead, which
    // buys 8.09/8.43/8.95/5.11:1 and leaves `hover:` pointing at -600 exactly
    // where it was. No palette entry moves, so nothing else in the app shifts.
    gold: 'bg-gold-500 hover:bg-gold-600 text-gray-950 shadow-sm',
    ghost: 'hover:bg-primary-50 dark:hover:bg-primary-800/40 text-primary-700 dark:text-primary-200',
    success: 'bg-success-500 hover:bg-success-600 text-gray-950 shadow-sm',
    error: 'bg-error-500 hover:bg-error-600 text-gray-950 shadow-sm',
    warning: 'bg-warning-500 hover:bg-warning-600 text-gray-950 shadow-sm',
  };
  const sizes: Record<string, string> = {
    // sm keeps the compact look but no longer shrinks below a tappable 40px.
    sm: 'px-3.5 py-2.5 text-sm rounded-lg',
    md: 'px-4 py-2.5 text-base rounded-xl',
    lg: 'px-6 py-3 text-lg rounded-xl',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={style}
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

/**
 * A labelled on/off switch.
 *
 * It is a real switch to assistive tech (`role` + `aria-checked`) rather than a bare
 * icon that only *looks* toggleable, and the track itself carries the state — a grey
 * knob on a hairline label is something sighted users miss too.
 */
export interface ToggleRowProps {
  label: string;
  /** Second line under the label: what the setting actually changes. */
  description?: string;
  icon?: ReactNode;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function ToggleRow({ label, description, icon, value, onChange, disabled }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary-900 dark:text-primary-100">{label}</p>
          {description && <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 ${
          value ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-700'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
            value ? '-translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
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
