import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Upload } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import SegmentedTabs from '../../components/SegmentedTabs';
import Button from '../../components/Button';
import DestinationsSettings from './DestinationsSettings';
import DestinationsImport from './DestinationsImport';
import RateSetup from './RateSetup';
import { getCurrentUserRoles } from '../../utils/auth';
import './Settings.css';

type Tab = 'destinations' | 'rates';

const Settings: React.FC = () => {
  const isSuperAdmin = getCurrentUserRoles().includes('super_admin');
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const initialTab: Tab = tabParam === 'rates' ? 'rates' : 'destinations';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showImport, setShowImport] = useState(false);

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

      <div className="settings-toolbar">
        <SegmentedTabs
          ariaLabel="Settings sections"
          value={tab}
          onChange={(v) => { setTab(v as Tab); setShowImport(false); }}
          options={[
            { value: 'destinations', label: 'Destinations & Areas' },
            { value: 'rates', label: 'Rate Setup' },
          ]}
        />
        <Button
          variant="primary"
          onClick={() => setShowImport((v) => !v)}
        >
          <Upload size={15} /> Import
        </Button>
      </div>

      <div className="settings-body">
        {showImport ? (
          <DestinationsImport />
        ) : (
          <>
            {tab === 'destinations' && <DestinationsSettings />}
            {tab === 'rates' && <RateSetup />}
          </>
        )}
      </div>
    </div>
  );
};

export default Settings;
