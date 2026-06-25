import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import StatusChip from '../../components/StatusChip';
import { listDeliveryRates, type DeliveryRate } from '../../services/deliveryRates.service';
import './VendorDeliveryCharges.css';

const formatMoney = (value: number) =>
  `Rs. ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const VendorDeliveryCharges: React.FC = () => {
  const [rates, setRates] = useState<DeliveryRate[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    listDeliveryRates()
      .then((res) => {
        if (!active) return;
        if (res?.success && Array.isArray(res.data)) {
          // Vendors only care about routes that are currently chargeable.
          setRates(res.data.filter((rate) => rate.isActive));
        }
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

  const visibleRates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rates;
    return rates.filter(
      (rate) =>
        rate.originLocationName.toLowerCase().includes(q) ||
        rate.destinationLocationName.toLowerCase().includes(q),
    );
  }, [rates, searchQuery]);

  const columns = useMemo(
    () => [
      {
        header: 'SN',
        accessor: (rate: DeliveryRate) => visibleRates.findIndex((r) => r.id === rate.id) + 1,
        width: '50px',
      },
      {
        header: 'ROUTE',
        accessor: (rate: DeliveryRate) => (
          <span className="vendor-delivery-route">
            {rate.originLocationName} → {rate.destinationLocationName}
          </span>
        ),
      },
      { header: 'BASE CHARGE', accessor: (rate: DeliveryRate) => formatMoney(rate.baseCharge), width: '150px' },
      { header: 'FREE WEIGHT', accessor: (rate: DeliveryRate) => `${rate.freeWeightKg} Kg`, width: '130px' },
      {
        header: 'EXTRA WEIGHT',
        accessor: (rate: DeliveryRate) => `${rate.extraWeightPercent}% / Kg`,
        width: '140px',
      },
      {
        header: 'STATUS',
        accessor: () => <StatusChip tone="success" variant="solid">Active</StatusChip>,
        width: '110px',
      },
    ],
    [visibleRates],
  );

  return (
    <div className="vendor-delivery-page">
      <PageHeader
        title="Delivery Charges"
        subtitle="View the delivery charges that apply to your shipments across the hub network."
      />

      <label className="vendor-delivery-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search by origin or destination"
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
