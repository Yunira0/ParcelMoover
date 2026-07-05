import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Upload } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import SegmentedTabs from '../../components/SegmentedTabs';
import Button from '../../components/Button';
import DestinationsSettings from './DestinationsSettings';
import DestinationsImport from './DestinationsImport';
import RateSetup from './RateSetup';
import { hasAdminPermission } from '../../utils/auth';
import './Settings.css';

type Tab = 'destinations' | 'rates';

const Settings: React.FC = () => {
  // super_admin, or an admin the super_admin granted SETTINGS_ACCESS to.
  const canConfigure = hasAdminPermission('SETTINGS_ACCESS');
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const initialTab: Tab = tabParam === 'rates' ? 'rates' : 'destinations';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showImport, setShowImport] = useState(false);

  if (!canConfigure) {
    return (
      <div className="settings-page">
        <PageHeader title="Settings" subtitle="Configuration is only available to super admins or admins granted settings access." />
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
          variant={showImport ? 'secondary' : 'primary'}
          onClick={() => setShowImport((v) => !v)}
        >
          {showImport ? (
            <><ArrowLeft size={15} /> Back to {tab === 'rates' ? 'Rate Setup' : 'Destinations'}</>
          ) : (
            <><Upload size={15} /> Import</>
          )}
        </Button>
      </div>

      <div className="settings-body">
        {showImport ? (
          // One flat sheet sets both the destination branch and its rate
          // (per-destination rate, zone, valley), so a single import serves both tabs.
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
