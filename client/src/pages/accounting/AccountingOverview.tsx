import React from 'react';
import PageHeader from '../../components/PageHeader';
import SummaryTab from './tabs/SummaryTab';
import './Accounting.css';

// Where the money is, and what it did this period. One screen, no tabs — the
// statements and the period-closing tools that used to sit beside it have been
// removed, so the landing page is the summary and nothing else.

const AccountingOverview: React.FC = () => (
  <div className="acc-page">
    <PageHeader
      title="Accounting Overview"
      subtitle="Where the money is, and what it did this period"
    />
    <SummaryTab />
  </div>
);

export default AccountingOverview;
