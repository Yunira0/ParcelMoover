import './SegmentedTabs.css';

export interface SegmentedTabOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedTabsProps<T extends string> {
  options: SegmentedTabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Full-width grid (operation pages with many tabs) vs shrink-to-content (e.g. Finance's 2-way toggle). */
  fullWidth?: boolean;
  minTabWidth?: string;
}

function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  fullWidth = true,
  minTabWidth = '120px',
}: SegmentedTabsProps<T>) {
  return (
    <div
      className={`segmented-tabs ${fullWidth ? 'segmented-tabs-full' : 'segmented-tabs-compact'}`}
      role="tablist"
      aria-label={ariaLabel}
      style={fullWidth ? { gridTemplateColumns: `repeat(${options.length}, minmax(${minTabWidth}, 1fr))` } : undefined}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={`segmented-tab ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default SegmentedTabs;
