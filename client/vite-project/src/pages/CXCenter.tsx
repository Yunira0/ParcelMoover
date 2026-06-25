import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import SegmentedTabs from '../components/SegmentedTabs';
import Tickets from './Tickets';
import Remarks from './Remarks';
import './CXCenter.css';

type CxTab = 'tickets' | 'remarks';

const TABS: { value: CxTab; label: string }[] = [
  { value: 'tickets', label: 'Tickets' },
  { value: 'remarks', label: 'Remarks' },
];

// Merges the Tickets and Remarks experiences behind one tab bar. Each tab still
// renders the existing page component unchanged, and the active tab is driven by
// the route (/tickets or /remarks) so the sidebar links and deep-links keep working.
const CXCenter: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab: CxTab = location.pathname.startsWith('/remarks') ? 'remarks' : 'tickets';

  const handleChange = (tab: CxTab) => {
    if (tab !== activeTab) {
      navigate(tab === 'remarks' ? '/remarks' : '/tickets');
    }
  };

  return (
    <div className="cx-center">
      <SegmentedTabs
        ariaLabel="CX views"
        value={activeTab}
        onChange={handleChange}
        options={TABS}
        fullWidth={false}
        minTabWidth="140px"
      />

      <div className="cx-center-body">
        {activeTab === 'tickets' ? <Tickets /> : <Remarks />}
      </div>
    </div>
  );
};

export default CXCenter;
