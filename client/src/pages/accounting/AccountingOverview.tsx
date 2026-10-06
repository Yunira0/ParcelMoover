import React, { useEffect, useState } from 'react';
import CODSettlement from '../../components/CODSettlement';
import DashboardHeader from '../../components/DashboardHeader';
import PageHeader from '../../components/PageHeader';
import { getCodSettlementSummary, type DashboardSummary } from '../../services/orders.service';
import { getCurrentUser, isAccountantUser } from '../../utils/auth';
import AccountantQueue from './AccountantQueue';
import SummaryTab from './tabs/SummaryTab';
import './Accounting.css';

// Where the money is, and what it did this period. One screen, no tabs — the
// statements and the period-closing tools that used to sit beside it have been
// removed, so the landing page is the summary and nothing else.

const EMPTY_COD: DashboardSummary['codSettlement'] = {
  totalCod: 0,
  settledCod: 0,
  pendingCod: 0,
  codFromRiders: 0,
  codFromPmRider: 0,
  codFromNcm: 0,
  codFromUpaya: 0,
  pendingDeliveryCharge: 0,
  deliveryCharge: 0,
  progressPercent: 0,
  scopedToRider: false,
  lastAmount: 0,
  lastSettledAt: null,
};

// The accountant never reaches the Dashboard, so its COD Settlement card is
// repeated here for them.
const AccountantCodCard: React.FC = () => {
  const [cod, setCod] = useState(EMPTY_COD);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getCodSettlementSummary()
      .then((data) => { if (active) setCod(data); })
      .catch(() => { /* the card keeps its zeros */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className="acc-cod-card">
      <CODSettlement data={cod} loading={loading} />
    </div>
  );
};

const AccountingOverview: React.FC = () => (
  <div className="acc-page">
    <DashboardHeader user={getCurrentUser()?.fullName || ''} />
    <PageHeader
      title="Accounting Overview"
    />
    {isAccountantUser() && <AccountantQueue />}
    <SummaryTab />
    {isAccountantUser() && <AccountantCodCard />}
  </div>
);

export default AccountingOverview;
