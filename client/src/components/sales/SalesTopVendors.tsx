import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Table from '../Table';
import StatusChip from '../StatusChip';
import { getVendors } from '../../services/users.service';
import './SalesTopVendors.css';

interface VendorRow {
  id: string;
  client: string;
  company: string;
  orders: { total: number; delivered: number; returned: number };
  codDue: number;
  status: 'active' | 'inactive';
}

const TOP_VENDORS_LIMIT = 8;
const formatMoney = (value: number) => `Rs. ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const SalesTopVendors: React.FC = () => {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getVendors()
      .then((res) => {
        if (!active) return;
        const data: VendorRow[] = res?.success && Array.isArray(res.data) ? res.data : [];
        setVendors(
          [...data]
            .sort((a, b) => (b.orders?.total ?? 0) - (a.orders?.total ?? 0))
            .slice(0, TOP_VENDORS_LIMIT),
        );
      })
      .catch(() => {
        if (active) setError('Failed to load vendor performance.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const columns = [
    { header: 'CLIENT', accessor: 'client' as const },
    { header: 'COMPANY', accessor: 'company' as const },
    { header: 'TOTAL ORDERS', accessor: (v: VendorRow) => v.orders.total.toLocaleString() },
    { header: 'DELIVERED', accessor: (v: VendorRow) => v.orders.delivered.toLocaleString() },
    { header: 'COD DUE', accessor: (v: VendorRow) => formatMoney(v.codDue) },
    {
      header: 'STATUS',
      accessor: (v: VendorRow) => (
        <StatusChip variant="solid" tone={v.status === 'active' ? 'success' : 'danger'}>
          {v.status}
        </StatusChip>
      ),
    },
  ];

  return (
    <div className="sales-top-vendors">
      <div className="sales-top-vendors-header">
        <h3 className="section-title">Vendor Performance</h3>
        <Link to="/vendors" className="sales-top-vendors-link">View all vendors</Link>
      </div>

      {error && <p className="sales-top-vendors-error">{error}</p>}

      <Table
        columns={columns}
        data={vendors}
        selectable={false}
        loading={loading}
        loadingMessage="Loading vendor performance..."
        emptyMessage="No vendors assigned yet."
      />
    </div>
  );
};

export default SalesTopVendors;
