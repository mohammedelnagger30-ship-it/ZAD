interface TimeOptionButtonGroupProps {
  /** List of numeric options (e.g., minutes). */
  options: number[];
  /** Currently selected value. */
  selected: number;
  /** Callback when an option is chosen. */
  onSelect: (value: number) => void;
}

/**
 * Reusable button group for selecting a numeric option.
 * Used in SettingsScreen for snooze duration and pre‑prayer reminder.
 */
export function TimeOptionButtonGroup({ options, selected, onSelect }: TimeOptionButtonGroupProps) {
  return (
    <div className="flex gap-1">
      {options.map((value) => (
        <button
          key={value}
          onClick={() => onSelect(value)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
            selected === value
              ? 'bg-primary-600 text-white'
              : 'bg-gray-50 dark:bg-primary-800/30 text-gray-600 dark:text-gray-300'
          }`}
        >
          {value === 0 ? 'إيقاف' : value}
        </button>
      ))}
    </div>
  );
}
