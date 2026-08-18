import React, { useEffect, useState } from 'react';
import FilterDropdown from '../../components/FilterDropdown';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import { listPeriods, type AccountingPeriod } from '../../services/accounting.service';
import { currentPeriodKey, type RangeMode, type RangeSelection } from './range';
import './Accounting.css';

// Every accounting screen is "as at" or "for" some window, and in Nepal that
// window is a BS month or a Shrawan–Ashadh fiscal year — not a calendar month.
// One control, shared, so the whole section answers the same question the same
// way. The selection type and its helpers live in ./range.
//
// Built from the same filter controls as every other list screen: a CAPS label
// over a searchable dropdown, and the app's BS date picker for custom ranges —
// a section that only speaks in Bikram Sambat should not fall back to an AD
// calendar the moment somebody picks their own dates.

interface PeriodPickerProps {
  value: RangeSelection;
  onChange: (range: RangeSelection) => void;
}

const MODE_OPTIONS = [
  { value: 'period', label: 'BS month' },
  { value: 'fiscalYear', label: 'Fiscal year' },
  { value: 'custom', label: 'Custom dates' },
];

const PeriodPicker: React.FC<PeriodPickerProps> = ({ value, onChange }) => {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);

  useEffect(() => {
    let active = true;
    listPeriods()
      .then((rows) => {
        if (active) setPeriods(rows);
      })
      // A picker that cannot list periods still works in custom-date mode, so
      // this is not worth an error banner across every page that uses it.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const fiscalYears = Array.from(new Set(periods.map((p) => p.fiscalYear))).sort().reverse();

  // The current month may have no entries yet, so it will not be in the list
  // the server returns — offer it regardless.
  const periodOptions = [
    ...(periods.some((p) => p.periodKey === currentPeriodKey())
      ? []
      : [{ value: currentPeriodKey(), label: `${currentPeriodKey()} (current)` }]),
    ...periods.map((p) => ({
      value: p.periodKey,
      label: `${p.monthName} ${p.bsYear}${p.status === 'closed' ? ' — closed' : ''}`,
    })),
  ];

  return (
    <div className="acc-period-picker">
      <FilterDropdown
        label="RANGE"
        value={value.mode}
        ariaLabel="Range type"
        options={MODE_OPTIONS}
        onChange={(next) => {
          const mode = next as RangeMode;
          if (mode === 'period') onChange({ mode, period: value.period || currentPeriodKey() });
          else if (mode === 'fiscalYear') onChange({ mode, fiscalYear: value.fiscalYear || fiscalYears[0] });
          else onChange({ mode, from: value.from, to: value.to });
        }}
      />

      {value.mode === 'period' && (
        <FilterDropdown
          label="MONTH"
          value={value.period ?? ''}
          ariaLabel="Accounting period"
          placeholder="Select month"
          searchPlaceholder="Search months..."
          options={periodOptions}
          onChange={(period) => onChange({ mode: 'period', period })}
        />
      )}

      {value.mode === 'fiscalYear' && (
        <FilterDropdown
          label="FISCAL YEAR"
          value={value.fiscalYear ?? ''}
          ariaLabel="Fiscal year"
          placeholder={fiscalYears.length === 0 ? 'No data yet' : 'Select year'}
          options={fiscalYears.map((fy) => ({ value: fy, label: `FY ${fy}` }))}
          onChange={(fiscalYear) => onChange({ mode: 'fiscalYear', fiscalYear })}
        />
      )}

      {value.mode === 'custom' && (
        <>
          <label aria-label="From date">
            <span>FROM</span>
            <NepaliDatePicker
              value={value.from ?? ''}
              onChange={(from) => onChange({ ...value, mode: 'custom', from })}
              placeholder="Start date"
            />
          </label>
          <label aria-label="To date">
            <span>TO</span>
            <NepaliDatePicker
              value={value.to ?? ''}
              onChange={(to) => onChange({ ...value, mode: 'custom', to })}
              placeholder="End date"
            />
          </label>
        </>
      )}
    </div>
  );
};

export default PeriodPicker;
