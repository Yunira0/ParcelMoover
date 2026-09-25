import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import SegmentedTabs from '../../components/SegmentedTabs';
import Pagination from '../../components/Pagination';
import SearchField from '../../components/SearchField';
import StatusChip from '../../components/StatusChip';
import { listManagedLocations, type Destination } from '../../services/locations.service';
import '../settings/Settings.css';
import '../settings/DestinationsSettings.css';

const ZONE_LABELS: Record<string, string> = {
  major_cities: 'Major cities',
  urban_areas: 'Urban areas',
  remote_areas: 'Remote areas',
  inside_valley: 'Inside valley',
};

const valleyLabel = (d: Destination) =>
  d.valley === 'inside'
    ? d.ringRoad === 'outside' ? 'Inside valley — outside ring road' : 'Inside valley'
    : d.valley === 'outside' ? 'Outside valley' : null;

const PAGE_SIZE = 10;

const DeliveryRateSettings = lazy(() => import('../DeliveryRateSettings'));

type Tab = 'destinations' | 'rates';

// A read-only view of the destination network for branch admins: they route
// and price parcels to these places but manage none of them. Editing stays in
// Destination Management, which only head office can open.
const DestinationsList: React.FC = () => {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);

  useEffect(() => {
    listManagedLocations()
      .then((res) => {
        if (res?.success) setDestinations([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => setError('Failed to load destinations.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return destinations.filter((d) =>
      d.isActive && (
        !q ||
        d.name.toLowerCase().includes(q) ||
        (d.code || '').toLowerCase().includes(q) ||
        d.areas.some((a) => a.isActive && a.name.toLowerCase().includes(q))
      ));
  }, [destinations, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSizeChoice));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * pageSizeChoice, currentPage * pageSizeChoice);

  return (
      <div className="dest-settings">
        <SearchField
          value={searchQuery}
          onChange={(value) => { setSearchQuery(value); setPage(1); }}
          placeholder="Search destinations, codes, or areas…"
        />

        {error && <p className="dest-error">{error}</p>}

        {loading ? (
          <p className="dest-muted">Loading destinations…</p>
        ) : filtered.length === 0 ? (
          <p className="dest-muted">
            {searchQuery ? `No destinations match "${searchQuery}".` : 'No destinations yet.'}
          </p>
        ) : (
          <>
            <div className="dest-list">
              {paged.map((dest) => {
                const areas = dest.areas.filter((a) => a.isActive);
                const valley = valleyLabel(dest);
                return (
                  <div key={dest.id} className="dest-card">
                    <div className="dest-card-head">
                      <div className="dest-card-title">
                        <MapPin size={16} />
                        <span>{dest.name}</span>
                        {dest.code && <span className="dest-code">{dest.code}</span>}
                        {dest.isHub && <StatusChip tone="info">Branch</StatusChip>}
                      </div>
                    </div>

                    {(dest.zone || valley) && (
                      <div className="dest-areas">
                        {dest.zone && <StatusChip tone="neutral">{ZONE_LABELS[dest.zone] ?? dest.zone}</StatusChip>}
                        {valley && <StatusChip tone="neutral">{valley}</StatusChip>}
                      </div>
                    )}

                    <div className="dest-areas">
                      {areas.length === 0 ? (
                        <span className="dest-muted">No covered areas.</span>
                      ) : (
                        areas.map((area) => (
                          <span key={area.id} className="dest-area-chip dest-area-chip--static">{area.name}</span>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Pagination
              page={currentPage}
              totalPages={totalPages}
              onPageChange={setPage}
              ariaLabel="Destinations pages"
              pageSize={pageSizeChoice}
              pageSizeLabel="destinations"
              onPageSizeChange={(size) => { setPageSizeChoice(size); setPage(1); }}
              summary={`Showing ${(currentPage - 1) * pageSizeChoice + 1}–${Math.min(currentPage * pageSizeChoice, filtered.length)} of ${filtered.length} destinations`}
            />
          </>
        )}
      </div>
  );
};

// The branch workspace's counterpart to head office's Destination Management:
// the destination network (view only) and the branch's own rates, as tabs.
const BranchDestinations: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'rates' ? 'rates' : 'destinations';

  return (
    <div className="settings-page">
      <PageHeader title="Destinations & Rates" />

      <div className="settings-toolbar">
        <SegmentedTabs
          ariaLabel="Destinations and rates"
          fullWidth={false}
          value={tab}
          onChange={(next) => setSearchParams(next === 'rates' ? { tab: 'rates' } : {}, { replace: true })}
          options={[
            { value: 'destinations', label: 'Destinations & Areas' },
            { value: 'rates', label: 'Rates' },
          ]}
        />
      </div>

      <div className="settings-body">
        {tab === 'destinations' ? (
          <DestinationsList />
        ) : (
          <Suspense fallback={<p className="dest-muted">Loading rates…</p>}>
            <DeliveryRateSettings embedded />
          </Suspense>
        )}
      </div>
    </div>
  );
};

export default BranchDestinations;
