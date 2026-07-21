import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getVendors } from '../services/users.service';
import './TopVendors.css';

interface VendorRow {
  id: string;
  client: string;
  company: string;
  orders?: { total: number; delivered: number; returned: number };
}

const TOP_LIMIT = 4;

const TopVendors: React.FC = () => {
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
            .slice(0, TOP_LIMIT),
        );
      })
      .catch(() => {
        if (active) setError('Vendor performance is unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const max = vendors.reduce((m, v) => Math.max(m, v.orders?.total ?? 0), 0) || 1;

  return (
    <section className="top-vendors" aria-label="Top vendors">
      <div className="top-vendors-header">
        <h3 className="section-title">Top vendors</h3>
        <Link to="/vendors" className="top-vendors-link">View all</Link>
      </div>

      {error && <p className="top-vendors-error">{error}</p>}

      {loading ? (
        <p className="top-vendors-empty">Loading vendor performance…</p>
      ) : vendors.length === 0 ? (
        <p className="top-vendors-empty">No vendors assigned yet.</p>
      ) : (
        <ul className="top-vendors-list">
          {vendors.map((v) => {
            const total = v.orders?.total ?? 0;
            return (
              <li key={v.id}>
                <div className="top-vendors-row">
                  <span className="top-vendors-name">{v.company || v.client}</span>
                  <span className="top-vendors-count">{total.toLocaleString()}</span>
                </div>
                <div className="top-vendors-track">
                  <span style={{ width: `${Math.round((total / max) * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default TopVendors;
