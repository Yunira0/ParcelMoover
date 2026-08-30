import React, { useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import SearchableSelectAsync from '../SearchableSelectAsync';
import NepaliDatePicker from '../NepaliDatePicker';
import Button from '../Button';
import { searchVendors } from '../../services/users.service';
import './MerchantFilterBar.css';

interface MerchantFilterBarProps {
  vendorId: string;
  vendorLabel?: string;
  onVendorChange: (id: string, label: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onClear: () => void;
}

const MerchantFilterBar: React.FC<MerchantFilterBarProps> = ({
  vendorId,
  vendorLabel,
  onVendorChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onClear,
}) => {
  const payeeLabelsRef = useRef<Map<string, string>>(new Map());
  if (vendorLabel && vendorId) payeeLabelsRef.current.set(vendorId, vendorLabel);

  const handleSearch = useCallback(async (search: string, offset: number) => {
    const res = await searchVendors(search, 50, offset);
    if (res?.success && Array.isArray(res.data)) {
      const results = (res.data as { id?: string; label?: string; phone?: string }[])
        .filter((v): v is { id: string; label: string; phone?: string } => Boolean(v.id && v.label))
        .map((v) => ({ id: v.id, label: v.label, description: v.phone }));
      results.forEach((o) => payeeLabelsRef.current.set(o.id, o.label));
      return { results, hasMore: res.hasMore ?? false };
    }
    return { results: [], hasMore: false };
  }, []);

  const selectVendor = (id: string) => {
    const label = id ? payeeLabelsRef.current.get(id) ?? '' : '';
    onVendorChange(id, label);
  };

  const hasFilters = Boolean(vendorId || dateFrom || dateTo);

  return (
    <div className="merchant-filter-toolbar">
      <div className="merchant-filter-group">
        <label className="merchant-filter-wide">
          <span>VENDOR</span>
          <div className="merchant-vendor-filter">
            <SearchableSelectAsync
              asyncSearch={handleSearch}
              value={vendorId}
              initialLabel={vendorLabel}
              onChange={selectVendor}
              placeholder="All vendors"
              searchPlaceholder="Search vendor by name…"
              emptyMessage="No vendors found."
            />
            {vendorId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => selectVendor('')}
                aria-label="Clear vendor filter"
              >
                <X size={14} />
              </Button>
            )}
          </div>
        </label>

        {/* Single DATE filter that contains From ~ To — like Vendor COD Settlement's date but as a range */}
        <label className="merchant-filter-daterange">
          <span>DATE</span>
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

export default MerchantFilterBar;
