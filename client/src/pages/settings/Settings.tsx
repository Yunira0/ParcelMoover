import React, { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import SegmentedTabs from '../../components/SegmentedTabs';
import DestinationsSettings from './DestinationsSettings';
import { hasAdminPermission } from '../../utils/auth';
import './Settings.css';

const DeliveryRateSettings = lazy(() => import('../DeliveryRateSettings'));

type Tab = 'destinations' | 'rates';
const TABS: Tab[] = ['destinations', 'rates'];

const Settings: React.FC = () => {
  // super_admin, or an admin the super_admin granted SETTINGS_ACCESS to.
  const canConfigure = hasAdminPermission('SETTINGS_ACCESS');
  // Read from the URL on every render rather than copied into state once, so
  // a link to ?tab=rates (e.g. a bookmark of the old Route Rates page) switches
  // tabs even when this page is already open.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'destinations';

  // The Rates tab's origin is meaningless on the other tabs; don't carry it.
  const setTab = (next: Tab) => setSearchParams(next === 'destinations' ? {} : { tab: next }, { replace: true });

  if (!canConfigure) {
    return (
      <div className="settings-page">
        <PageHeader title="Destination Management" />
      </div>
    );
  }

  return (
    <div className="settings-page">
      <PageHeader
        title="Destination Management"
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
          ]}
        />
      </div>

      <div className="settings-body">
        {tab === 'destinations' && <DestinationsSettings />}
        {tab === 'rates' && (
          <Suspense fallback={<p className="dest-muted">Loading rates…</p>}>
            <DeliveryRateSettings embedded />
          </Suspense>
        )}
      </div>
    </div>
  );
};

export default Settings;
