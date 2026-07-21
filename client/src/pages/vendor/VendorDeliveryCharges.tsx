import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import StatusChip from '../../components/StatusChip';
import { getMyDeliveryRates, type VendorSelfRate, type VendorSelfRates } from '../../services/deliveryRates.service';
import { formatCurrency as formatMoney } from '../../utils/format';
import './VendorDeliveryCharges.css';

const RATE_TYPE_LABELS: Record<VendorSelfRates['rateType'], string> = {
  flat: 'Flat rate',
  zone: 'Zone rate',
  per_destination: 'Per-destination rate',
};

const RATE_TYPE_HINTS: Record<VendorSelfRates['rateType'], string> = {
  flat: 'A single rate per valley band — every destination inside the valley shares one rate, and every destination outside shares another.',
  zone: 'Rate is set per delivery zone, so destinations in the same zone share the same charge.',
  per_destination: 'Each destination carries its own individually-set rate.',
};

const ZONE_LABELS: Record<string, string> = {
  major_cities: 'Major cities',
  urban_areas: 'Urban areas',
  remote_areas: 'Remote areas',
  inside_valley: 'Inside valley',
};

const VendorDeliveryCharges: React.FC = () => {
  const [data, setData] = useState<VendorSelfRates | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    getMyDeliveryRates()
      .then((res) => {
        if (!active) return;
        if (res?.success && res.data) setData(res.data);
      })
      .catch((err) => {
        if (active) setError(err?.response?.data?.message || 'Failed to load delivery charges.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const rates = data?.rates ?? [];

  const visibleRates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rates;
    return rates.filter((rate) => rate.destinationName.toLowerCase().includes(q));
  }, [rates, searchQuery]);

  const columns = useMemo(
    () => [
      {
        header: 'SN',
        accessor: (rate: VendorSelfRate) => visibleRates.findIndex((r) => r.destinationId === rate.destinationId) + 1,
        width: '50px',
      },
      {
        header: 'DESTINATION',
        accessor: (rate: VendorSelfRate) => <span className="vendor-delivery-route">{rate.destinationName}</span>,
      },
      // Zone is only meaningful for zone-rate vendors.
      ...(data?.rateType === 'zone'
        ? [
            {
              header: 'ZONE',
              accessor: (rate: VendorSelfRate) => (rate.zone ? ZONE_LABELS[rate.zone] || rate.zone : '—'),
              width: '150px',
            },
          ]
        : []),
      {
        header: 'DELIVERY RATE',
        accessor: (rate: VendorSelfRate) =>
          rate.homeRate !== null ? formatMoney(rate.homeRate) : <span className="vendor-delivery-unset">Not set</span>,
        width: '150px',
      },
      {
        header: 'BRANCH RATE',
        accessor: (rate: VendorSelfRate) =>
          rate.branchRate !== null ? formatMoney(rate.branchRate) : <span className="vendor-delivery-unset">—</span>,
        width: '150px',
      },
      { header: 'FREE WEIGHT', accessor: () => `${data?.freeWeightKg ?? 0} Kg`, width: '130px' },
      {
        header: 'EXTRA WEIGHT',
        accessor: () => `${data?.extraWeightPercent ?? 0}% / Kg`,
        width: '140px',
      },
    ],
    [visibleRates, data],
  );

  return (
    <div className="vendor-delivery-page">
      <PageHeader
        title="Delivery Charges"
        subtitle="The delivery rates that apply to your shipments, based on your assigned pricing plan."
      />

      {data && (
        <div className="vendor-delivery-plan">
          <StatusChip tone="info" variant="solid">{RATE_TYPE_LABELS[data.rateType]}</StatusChip>
          <span className="vendor-delivery-plan-hint">{RATE_TYPE_HINTS[data.rateType]}</span>
        </div>
      )}

      <label className="vendor-delivery-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search by destination"
        />
      </label>

      {error && <p className="vendor-delivery-error">{error}</p>}

      <Table
        columns={columns}
        data={visibleRates}
        selectable={false}
        loading={loading}
        loadingMessage="Loading delivery charges..."
        emptyMessage="No delivery charges available."
        minWidth="820px"
      />
    </div>
  );
};

export default VendorDeliveryCharges;
