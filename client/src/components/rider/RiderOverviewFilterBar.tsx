import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import SearchableSelect, { type SearchableSelectOption } from '../SearchableSelect';
import NepaliDatePicker from '../NepaliDatePicker';
import Button from '../Button';
import { getRiders } from '../../services/users.service';
import '../merchant/MerchantFilterBar.css';
import '../branch/BranchOverviewFilterBar.css';

interface RiderOverviewFilterBarProps {
  riderId: string;
  onRiderChange: (id: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onClear: () => void;
}

// Same shape as MerchantFilterBar (Vendor Overview): a single wide picker on
// the left, a DATE range, and a Clear button — but riders instead of vendors.
// The roster is small enough (unlike vendors) to load once, so this is a
// sync SearchableSelect rather than the async vendor picker.
const RiderOverviewFilterBar: React.FC<RiderOverviewFilterBarProps> = ({
  riderId,
  onRiderChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClear,
}) => {
  const [riders, setRiders] = useState<Array<{ id: string; name: string; location: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getRiders({ pageSize: 100, status: 'active' })
      .then((res) => {
        if (!active) return;
        if (res?.success && Array.isArray(res.data)) {
          setRiders(res.data.map((r: any) => ({ id: r.id, name: r.name, location: r.location || '' })));
        }
      })
      .catch(() => { /* dropdown is non-critical */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const options: SearchableSelectOption[] = [
    { id: '', label: 'All riders' },
    ...riders.map((r) => ({ id: r.id, label: r.name, description: r.location || undefined })),
  ];

  const hasFilters = Boolean(riderId || dateFrom || dateTo);

  return (
    <div className="merchant-filter-toolbar">
      <div className="merchant-filter-group">
        <label className="merchant-filter-wide">
          <span>Rider</span>
          <SearchableSelect
            options={options}
            value={riderId}
            onChange={onRiderChange}
            placeholder={loading ? 'Loading…' : 'All riders'}
            searchPlaceholder="Search riders…"
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

export default RiderOverviewFilterBar;
