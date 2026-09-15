import React, { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Upload } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import SegmentedTabs from '../../components/SegmentedTabs';
import Button from '../../components/Button';
import DestinationsSettings from './DestinationsSettings';
import RateSetup from './RateSetup';
import { hasAdminPermission } from '../../utils/auth';
import './Settings.css';

const DestinationsImport = lazy(() => import('./DestinationsImport'));
const DeliveryRateSettings = lazy(() => import('../DeliveryRateSettings'));

type Tab = 'destinations' | 'rates' | 'pricing';
const TABS: Tab[] = ['destinations', 'rates', 'pricing'];

const Settings: React.FC = () => {
  // super_admin, or an admin the super_admin granted SETTINGS_ACCESS to.
  const canConfigure = hasAdminPermission('SETTINGS_ACCESS');
  // Read from the URL on every render rather than copied into state once, so
  // a link to ?tab=rates (from Global Pricing, or a bookmark of the old Route
  // Rates page) switches tabs even when this page is already open.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'destinations';
  const [showImport, setShowImport] = useState(false);

  const setTab = (next: Tab) => {
    setShowImport(false);
    // The Rates tab's origin is meaningless on the other tabs; don't carry it.
    setSearchParams(next === 'destinations' ? {} : { tab: next }, { replace: true });
  };

  if (!canConfigure) {
    return (
      <div className="settings-page">
        <PageHeader title="Destination Management" subtitle="Configuration is only available to super admins or admins granted settings access." />
      </div>
    );
  }

  return (
    <div className="settings-page">
      <PageHeader
        title="Destination Management"
        subtitle="Define destinations, the areas they cover, and the delivery rates to them from each origin."
      />

      <div className="settings-toolbar">
        <SegmentedTabs
          ariaLabel="Settings sections"
          fullWidth={false}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          options={[
            { value: 'destinations', label: 'Destinations & Areas' },
            { value: 'rates', label: 'Rates' },
            { value: 'pricing', label: 'Global Pricing' },
          ]}
        />
        {/* This imports destinations and their covered areas, so it belongs to
            that tab only. Rates carries its own import, shaped to the selected
            origin; Global Pricing has nothing to import. */}
        {tab === 'destinations' && (
          <Button
            variant="secondary"
            onClick={() => setShowImport((v) => !v)}
          >
            {showImport ? (
              <><ArrowLeft size={16} /> Back to destinations</>
            ) : (
              <><Upload size={16} /> Import</>
            )}
          </Button>
        )}
      </div>

      <div className="settings-body">
        {showImport && tab === 'destinations' ? (
          <Suspense fallback={<p className="dest-muted">Loading import…</p>}>
            <DestinationsImport />
          </Suspense>
        ) : (
          <>
            {tab === 'destinations' && <DestinationsSettings />}
            {tab === 'rates' && (
              <Suspense fallback={<p className="dest-muted">Loading rates…</p>}>
                <DeliveryRateSettings embedded />
              </Suspense>
            )}
            {tab === 'pricing' && <RateSetup />}
          </>
        )}
      </div>
    </div>
  );
};

export default Settings;
