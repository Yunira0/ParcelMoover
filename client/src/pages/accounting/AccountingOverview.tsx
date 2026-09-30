import React from 'react';
import DashboardHeader from '../../components/DashboardHeader';
import PageHeader from '../../components/PageHeader';
import { getCurrentUser } from '../../utils/auth';
import SummaryTab from './tabs/SummaryTab';
import './Accounting.css';

// Where the money is, and what it did this period. One screen, no tabs — the
// statements and the period-closing tools that used to sit beside it have been
// removed, so the landing page is the summary and nothing else.

const AccountingOverview: React.FC = () => (
  <div className="acc-page">
    <DashboardHeader user={getCurrentUser()?.fullName || ''} />
    <PageHeader
      title="Accounting Overview"
    />
    <SummaryTab />
  </div>
);

export default AccountingOverview;
