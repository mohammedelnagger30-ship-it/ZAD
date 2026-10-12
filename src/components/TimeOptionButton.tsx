interface TimeOptionButtonProps {
  /** Label displayed before the button group */
  label: string;
  /** Current selected value */
  value: number;
  /** Options to present as buttons */
  options: number[];
  /** Callback when a new option is selected */
  onSelect: (val: number) => void;
}

/**
 * Reusable button group for selecting a numeric option.
 * Used in SettingsScreen for snooze minutes and pre‑prayer reminder.
 */
export function TimeOptionButton({ label, value, options, onSelect }: TimeOptionButtonProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <span>{label}</span>
      </div>
      <div className="flex flex-wrap justify-end gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onSelect(opt)}
            className={`min-h-11 px-3 py-2 rounded-lg text-xs md:text-sm font-medium ${
              value === opt
                ? 'bg-primary-600 text-white'
                : 'bg-gray-50 dark:bg-primary-800/30 text-gray-600 dark:text-gray-300'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
};
