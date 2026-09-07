import React from 'react';
import { X } from 'lucide-react';
import SearchableSelect, { type SearchableSelectOption } from '../SearchableSelect';
import NepaliDatePicker from '../NepaliDatePicker';
import Button from '../Button';
import { useBranchScope } from '../../context/BranchScopeContext';
import '../merchant/MerchantFilterBar.css';
import './BranchOverviewFilterBar.css';

interface BranchOverviewFilterBarProps {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onClear: () => void;
}

// Same shape as MerchantFilterBar (Vendor Overview): a wide picker group on the
// left, a DATE range, and a Clear button — but two branch pickers (origin hub →
// destination hub) instead of one vendor picker.
const BranchOverviewFilterBar: React.FC<BranchOverviewFilterBarProps> = ({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClear,
}) => {
  const { fromBranchId, toBranchId, setFromBranchId, setToBranchId, branches, loading } =
    useBranchScope();

  const options = (allLabel: string): SearchableSelectOption[] => [
    { id: 'all', label: allLabel },
    ...branches.map((b) => ({ id: b.id, label: b.name, description: b.district ?? undefined })),
  ];

  const hasFilters = fromBranchId !== 'all' || toBranchId !== 'all' || !!dateFrom || !!dateTo;

  return (
    <div className="merchant-filter-toolbar">
      <div className="merchant-filter-group">
        <label className="merchant-filter-wide branch-filter-narrow">
          <span>From Branch</span>
          <SearchableSelect
            options={options('All branches')}
            value={fromBranchId}
            onChange={setFromBranchId}
            placeholder={loading ? 'Loading…' : 'All branches'}
            searchPlaceholder="Search branches…"
            disabled={loading}
          />
        </label>

        <label className="merchant-filter-wide branch-filter-narrow">
          <span>To Branch</span>
          <SearchableSelect
            options={options('Any destination')}
            value={toBranchId}
            onChange={setToBranchId}
            placeholder={loading ? 'Loading…' : 'Any destination'}
            searchPlaceholder="Search branches…"
            disabled={loading}
          />
        </label>

        <label className="merchant-filter-daterange">
          <span>Date</span>
          <div className="merchant-filter-range">
            <NepaliDatePicker
              value={dateFrom}
              max={dateTo || undefined}
              onChange={onDateFromChange}
              placeholder="From"
              aria-label="Date range start"
            />
            <span className="merchant-filter-range-sep" aria-hidden="true">~</span>
            <NepaliDatePicker
              value={dateTo}
              min={dateFrom || undefined}
              onChange={onDateToChange}
              placeholder="To"
              aria-label="Date range end"
            />
          </div>
        </label>
      </div>

      {hasFilters && (
        <Button variant="outline" size="sm" onClick={onClear} className="merchant-filter-clear">
          <X size={14} /> Clear
        </Button>
      )}
    </div>
  );
};

export default BranchOverviewFilterBar;
