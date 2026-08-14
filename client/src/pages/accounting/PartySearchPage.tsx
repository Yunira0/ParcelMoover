import React from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import PartySearchTab from './tabs/PartySearchTab';
import './Accounting.css';

// Reached from the vendor and rider ledgers rather than from the nav, because
// it answers a question those two lists cannot: staff have no control account,
// so they are on neither, yet money is still spent on them.

const PartySearchPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="acc-page">
      <PageHeader
        title="Search Anyone"
        subtitle="Everything paid to and collected from a rider, vendor or staff member"
        onBack={() => navigate('/accounting/ledgers/vendor')}
      />
      <PartySearchTab />
    </div>
  );
};

export default PartySearchPage;
