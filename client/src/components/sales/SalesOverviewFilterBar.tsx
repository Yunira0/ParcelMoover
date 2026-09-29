import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import SearchableSelect, { type SearchableSelectOption } from '../SearchableSelect';
import NepaliDatePicker from '../NepaliDatePicker';
import Button from '../Button';
import { getAdmins } from '../../services/users.service';
import '../merchant/MerchantFilterBar.css';
import '../branch/BranchOverviewFilterBar.css';

interface SalesOverviewFilterBarProps {
  salesUserId: string;
  onSalesUserChange: (id: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onClear: () => void;
}

// Same shape as MerchantFilterBar (Vendor Overview): a single wide picker on
// the left, a DATE range, and a Clear button — but sales reps instead of
// vendors. "Sales rep" = an admin account in the Sales department (see
// VendorFormPage's identical filter), not a separate user type, so this
// reuses getAdmins() rather than a dedicated endpoint.
const SalesOverviewFilterBar: React.FC<SalesOverviewFilterBarProps> = ({
  salesUserId,
  onSalesUserChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClear,
}) => {
  const [salesReps, setSalesReps] = useState<Array<{ userId: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getAdmins({ pageSize: 100, status: 'active' })
      .then((res) => {
        if (!active) return;
        if (res?.success && Array.isArray(res.data)) {
          setSalesReps(
            res.data
              .filter((a: any) => (a.department || '').toLowerCase() === 'sales')
              .map((a: any) => ({ userId: a.userId, name: a.name })),
          );
        }
      })
      .catch(() => { /* dropdown is non-critical */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const options: SearchableSelectOption[] = [
    { id: '', label: 'All sales reps' },
    ...salesReps.map((s) => ({ id: s.userId, label: s.name })),
  ];

  const hasFilters = Boolean(salesUserId || dateFrom || dateTo);

  return (
    <div className="merchant-filter-toolbar">
      <div className="merchant-filter-group">
        <label className="merchant-filter-wide">
          <span>Sales Rep</span>
          <SearchableSelect
            options={options}
            value={salesUserId}
            onChange={onSalesUserChange}
            placeholder={loading ? 'Loading…' : 'All sales reps'}
            searchPlaceholder="Search sales reps…"
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

export default SalesOverviewFilterBar;
