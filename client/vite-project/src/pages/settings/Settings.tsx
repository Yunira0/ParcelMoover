import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import SegmentedTabs from '../../components/SegmentedTabs';
import DestinationsSettings from './DestinationsSettings';
import RateSetup from './RateSetup';
import { getCurrentUserRoles } from '../../utils/auth';
import './Settings.css';

type Tab = 'destinations' | 'rates';

const Settings: React.FC = () => {
  const isSuperAdmin = getCurrentUserRoles().includes('super_admin');
  const [searchParams] = useSearchParams();
  // Allow deep-linking straight to a tab, e.g. /settings?tab=rates
  const initialTab: Tab = searchParams.get('tab') === 'rates' ? 'rates' : 'destinations';
  const [tab, setTab] = useState<Tab>(initialTab);

  if (!isSuperAdmin) {
    return (
      <div className="settings-page">
        <PageHeader title="Settings" subtitle="Configuration is only available to super admins." />
      </div>
    );
  }

  return (
    <div className="settings-page">
      <PageHeader
        title="Settings"
        subtitle="Define destinations, the areas they cover, and the delivery rates between them."
      />

      <SegmentedTabs
        ariaLabel="Settings sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'destinations', label: 'Destinations & Areas' },
          { value: 'rates', label: 'Rate Setup' },
        ]}
      />

      <div className="settings-body">
        {tab === 'destinations' ? <DestinationsSettings /> : <RateSetup />}
      </div>
    </div>
  );
};

export default Settings;
