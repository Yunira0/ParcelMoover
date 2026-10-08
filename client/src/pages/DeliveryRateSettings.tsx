import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Upload, X } from 'lucide-react';
import DeliveryRatesImport from './DeliveryRatesImport';
import RateCard from './rates/RateCard';
import WeightRules from './rates/WeightRules';
import FormField from '../components/FormField';
import PageHeader from '../components/PageHeader';
import Banner from '../components/Banner';
import Button from '../components/Button';
import { listManagedLocations, type Destination } from '../services/locations.service';
import { listDeliveryRates, type DeliveryRate } from '../services/deliveryRates.service';
import { getCurrentUserLocationId, getCurrentUserRoles, hasAdminPermission, isBranchWorkspaceUser } from '../utils/auth';
import { apiErrorMessage } from '../utils/serverValidation';
import './DeliveryRateSettings.css';

const DestinationsImport = lazy(() => import('./settings/DestinationsImport'));

// The central hub. Its rates are the head-office card on `locations`
// (per_destination_rate), which vendors' own rate cards override - every other
// origin prices off the delivery_rates route table instead. Matched on a
// top-level location only: a covered area can share the name "Imadol" under a
// different destination, and mistaking it for the hub misprices every order
// (see order.service.ts's own parent_id: null check).
const isHeadOffice = (d: Destination) =>
  !d.parentId && ((d.code || '').trim().toUpperCase() === 'IMADOL' || d.name.trim().toLowerCase() === 'imadol');

interface Props {
  /** Rendered as a tab inside Destination Management, which supplies the page header. */
  embedded?: boolean;
}

const DeliveryRateSettings: React.FC<Props> = ({ embedded = false }) => {
  // The server scopes a branch-scoped admin to routes originating from their
  // own hub; lock the Origin field to match instead of letting them pick one
  // that would just get rejected on load.
  const isBranchWorkspace = isBranchWorkspaceUser();
  const ownLocationId = getCurrentUserLocationId();
  // super_admin, an admin the super_admin granted SETTINGS_ACCESS to, or any
  // branch workspace admin - their access is already scoped to their own hub
  // server-side, so no separate delegation is needed on top of that.
  const canConfigure = hasAdminPermission('SETTINGS_ACCESS') || isBranchWorkspace;
  // The head-office card writes through PATCH /locations, which has no branch
  // carve-out - so a branch admin could never save there even if they saw it.
  const canEditHeadOffice = hasAdminPermission('SETTINGS_ACCESS');

  const [searchParams, setSearchParams] = useSearchParams();
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [rates, setRates] = useState<DeliveryRate[]>([]);
  const [loadingDestinations, setLoadingDestinations] = useState(true);
  const [loadingRates, setLoadingRates] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [showImport, setShowImport] = useState(false);

  const headOffice = useMemo(() => destinations.find(isHeadOffice) ?? null, [destinations]);

  // Origins are branches only - head office and the locations set up through
  // Add Branch - never plain destinations, which don't ship parcels. A branch
  // admin is pinned to their own hub whatever the URL says - the server 403s the
  // rest, this just keeps the page from showing an error instead of their own rates.
  const originOptions = useMemo(() => {
    const tops = destinations.filter((d) => !d.parentId && d.isActive && (d.isHub || isHeadOffice(d)));
    const pool = isBranchWorkspace && ownLocationId ? tops.filter((d) => d.id === ownLocationId) : tops;
    return [...pool]
      .sort((a, b) => {
        if (isHeadOffice(a)) return -1;
        if (isHeadOffice(b)) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((d) => ({
        id: d.id,
        label: d.name,
        description: isHeadOffice(d) ? 'Head office rate card' : 'Branch route rates',
      }));
  }, [destinations, isBranchWorkspace, ownLocationId]);

  const requestedOrigin = searchParams.get('origin') ?? '';
  const selectedOrigin = useMemo(() => {
    if (isBranchWorkspace && ownLocationId) return ownLocationId;
    if (requestedOrigin && originOptions.some((o) => o.id === requestedOrigin)) return requestedOrigin;
    return headOffice?.id ?? originOptions[0]?.id ?? '';
  }, [isBranchWorkspace, ownLocationId, requestedOrigin, originOptions, headOffice]);

  const isHeadOfficeView = Boolean(headOffice && selectedOrigin === headOffice.id);

  const loadDestinations = useCallback(async () => {
    try {
      const res = await listManagedLocations();
      if (res?.success && Array.isArray(res.data)) {
        setDestinations([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
      }
    } catch {
      setLoadError('Failed to load destinations.');
    } finally {
      setLoadingDestinations(false);
    }
  }, []);

  useEffect(() => {
    if (canConfigure) void loadDestinations();
  }, [canConfigure, loadDestinations]);

  const loadRates = useCallback(async () => {
    // The head-office view reads its rates off the destinations themselves.
    if (!selectedOrigin || isHeadOfficeView) { setRates([]); return; }
    setLoadingRates(true);
    setLoadError('');
    try {
      const res = await listDeliveryRates(selectedOrigin);
      if (res?.success) setRates(res.data);
    } catch (err) {
      setRates([]);
      setLoadError(apiErrorMessage(err, 'Failed to load rates for this origin.'));
    } finally {
      setLoadingRates(false);
    }
  }, [selectedOrigin, isHeadOfficeView]);

  useEffect(() => { void loadRates(); }, [loadRates]);

  // Head office's rates live on the destinations themselves, so a write there
  // needs the destinations refetched, not just this origin's routes.
  const reloadAll = useCallback(async () => {
    await Promise.all([loadDestinations(), loadRates()]);
  }, [loadDestinations, loadRates]);

  if (!canConfigure) {
    return (
      <div className="rates-page">
        <PageHeader title="Rates" />
      </div>
    );
  }

  // Rates live as a tab: head office's Destination Management, or the branch
  // workspace's Destinations & Rates page. This old standalone route only
  // forwards bookmarks to whichever one the viewer can open.
  if (!embedded) {
    const origin = searchParams.get('origin');
    const base = isBranchWorkspace ? '/branches/destinations' : '/settings';
    return <Navigate to={`${base}?tab=rates${origin && !isBranchWorkspace ? `&origin=${encodeURIComponent(origin)}` : ''}`} replace />;
  }

  const showImportButton = !isHeadOfficeView || canEditHeadOffice;

  const toggleImport = () => {
    // DestinationsImport has no completion callback, so pick up whatever it
    // wrote when the panel closes.
    if (showImport && isHeadOfficeView) void loadDestinations();
    setShowImport((v) => !v);
  };

  const controls = (
    <>
      <FormField
        label="Origin"
        type="searchable-select"
        searchableOptions={originOptions}
        value={selectedOrigin}
        onChange={(id) => {
          setShowImport(false);
          // Functional update so the tab param Destination Management keeps in
          // the same URL survives an origin change.
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (id) next.set('origin', id); else next.delete('origin');
            return next;
          }, { replace: true });
        }}
        placeholder="Select origin"
        disabled={isBranchWorkspace || loadingDestinations}
      />
      {showImportButton && (
        <Button variant={showImport ? 'primary' : 'secondary'} onClick={toggleImport}>
          {showImport ? <><X size={16} /> Close import</> : <><Upload size={16} /> Import</>}
        </Button>
      )}
    </>
  );

  // Each origin imports its own shape: head office's per-destination rates, or
  // this branch's origin → destination route rows.
  const importPanel = !showImport ? undefined : isHeadOfficeView ? (
    <Suspense fallback={<p className="rates-page-muted">Loading import…</p>}>
      <DestinationsImport />
    </Suspense>
  ) : (
    <DeliveryRatesImport onImported={loadRates} />
  );

  return (
    <div className="rates-page">
      {loadError && <Banner tone="danger">{loadError}</Banner>}

      <RateCard
        // Remounting on an origin change drops any half-typed edits, so one
        // origin's numbers can never be saved onto another origin's rates.
        key={selectedOrigin}
        destinations={destinations}
        isHeadOffice={isHeadOfficeView}
        originLocationId={selectedOrigin}
        rates={rates}
        loading={loadingDestinations || loadingRates}
        canEditRates={isHeadOfficeView ? canEditHeadOffice : canConfigure}
        onChanged={reloadAll}
        controls={controls}
        // Network-wide, so branch admins don't see them; only a super admin can save.
        leading={isBranchWorkspace ? undefined : <WeightRules canEdit={getCurrentUserRoles().includes('super_admin')} />}
        importPanel={importPanel}
      />
    </div>
  );
};

export default DeliveryRateSettings;
