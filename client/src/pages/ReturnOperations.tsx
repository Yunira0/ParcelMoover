import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Download, Printer, Search, X } from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import SegmentedTabs from '../components/SegmentedTabs';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import StatusChip from '../components/StatusChip';
import QuickRemarkPopup from '../components/QuickRemarkPopup';
import SearchableSelectAsync, {
  type SearchableSelectAsyncOption,
  type SearchableSelectAsyncResult,
} from '../components/SearchableSelectAsync';
import {
  getOrders,
  bulkUpdateOrderStatus,
  subscribeToOrderStatusChanged,
  type Order,
  type ParcelStatus,
} from '../services/orders.service';
import { downloadExcel } from '../utils/excel';
import RiderAssignModal from '../components/RiderAssignModal';
import AddToReturnManifestModal from '../components/AddToReturnManifestModal';
import { toBsDate, toBsDateTime, toBsDateTimeCell } from '../utils/nepaliDate';
import { STATUS_TIMELINE_HEADERS, statusTimelineCells } from '../utils/orderStatus';
import { printLabels } from '../utils/printLabels';
import {
  getReturnManifest,
  getReturnManifests,
  removeParcelFromReturnManifest,
  receiveReturnManifest,
  sendReturnManifest,
  RETURN_MANIFEST_STATUS_LABELS,
  type ReturnManifest,
  type ReturnManifestDetail,
  type ReturnManifestParcel,
} from '../services/returnManifests.service';
import { printReturnManifests } from '../utils/printReturnManifest';
import { searchVendors } from '../services/users.service';
import { apiErrorMessage } from '../utils/serverValidation';
import './ReturnOperations.css';

// "manifests" sits between ready_to_return and sent_to_vendor because that is
// where it sits physically: parcels are marked for return, gathered onto a
// vendor's manifest, and only then handed to a rider. Unlike the other four it
// isn't derived from parcel status - it lists manifest rows.
type ReturnTab = 'follow_up' | 'ready_to_return' | 'manifests' | 'sent_to_vendor' | 'returned_to_vendor';

/** The four tabs that are parcel-derived, i.e. everything but "manifests". */
type ParcelReturnTab = Exclude<ReturnTab, 'manifests'>;

const PAGE_SIZE = 10;
const MANIFEST_PAGE_SIZE = 20;

const TAB_LABELS: Record<ReturnTab, string> = {
  follow_up: 'Follow up',
  ready_to_return: 'Ready to return',
  manifests: 'Manifests',
  sent_to_vendor: 'Sent to vendor',
  returned_to_vendor: 'Returned to vendor',
};

const STATUS_LABELS: Partial<Record<ParcelStatus, string>> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  arrived: 'Arrived at Origin',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'Sent for Delivery',
  oov: 'Transit',
  dispatched: 'In Transit',
  arrived_at_branch: 'Arrived at Destination',
  hold: 'On Hold',
  delivered: 'Delivered',
  partially_delivered: 'Partially Delivered',
  failed_delivery: 'Failed Delivery',
  follow_up: 'Follow Up',
  ready_to_return: 'Ready to Return',
  sent_to_vendor: 'Sent to Vendor',
  returned_to_vendor: 'Returned to Vendor',
};

// Maps any return-relevant parcel into one of the four return stages.
// Type 2 (RTO of a failed delivery) maps by its real status; Type 1 (an
// order_type='return' reverse shipment) maps by where it is in its lifecycle.
const returnStage = (o: Order): ParcelReturnTab | null => {
  if (o.status === 'failed_delivery' || o.status === 'follow_up') return 'follow_up';
  if (o.status === 'ready_to_return') return 'ready_to_return';
  if (o.status === 'sent_to_vendor') return 'sent_to_vendor';
  if (o.status === 'returned_to_vendor') return 'returned_to_vendor';
  if (o.orderType === 'return') {
    if (o.status === 'delivered') return 'returned_to_vendor';
    if (['pickup_ordered', 'rider_assigned'].includes(o.status)) return 'ready_to_return';
    return 'sent_to_vendor';
  }
  return null;
};

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

// Every status that can put a parcel into one of the four return tabs, on top
// of the separate orderType==='return' sweep below (see returnStage).
const RETURN_STATUS_FILTER: ParcelStatus[] = [
  'failed_delivery', 'follow_up', 'ready_to_return', 'sent_to_vendor', 'returned_to_vendor',
];
const SERVER_FETCH_PAGE_SIZE = 100;
const MAX_FETCH_PAGES = 20; // safety cap: 2000 orders per sweep

// Cursor-walks one filtered query to exhaustion instead of relying on the
// backend's capped (200-row, company-wide) unfiltered list default.
const fetchAllPages = async (params: { status?: ParcelStatus[]; orderType?: 'return' }) => {
  const all: Order[] = [];
  let cursor: string | undefined;
  let truncated = false;
  for (let i = 0; i < MAX_FETCH_PAGES; i++) {
    const res = await getOrders({ ...params, pageSize: SERVER_FETCH_PAGE_SIZE, cursor, dir: 'next', withArrival: true });
    if (!res?.success || !Array.isArray(res.data)) throw new Error('Unexpected orders response');
    all.push(...res.data);
    const hasMore = !!res.meta?.hasNextPage && !!res.meta?.nextCursor;
    if (!hasMore) return { all, truncated };
    cursor = res.meta!.nextCursor!;
    if (i === MAX_FETCH_PAGES - 1) truncated = true;
  }
  return { all, truncated };
};

// Columns for the manifest drill-down. Mirrors the printed RTV sheet, so what
// an operator checks on screen is what the vendor signs for on paper. Takes the
// parcel list because the shared Table hands accessors only the row - the same
// reason groupDetailColumns in PickupOperations does its own indexOf.
const manifestParcelColumns = (parcels: ReturnManifestParcel[]) => [
  {
    header: 'S.N',
    accessor: (parcel: ReturnManifestParcel) => parcels.indexOf(parcel) + 1,
    width: '55px',
  },
  { header: 'ORDER ID', accessor: (p: ReturnManifestParcel) => `#${p.orderNumber}`, width: '80px' },
  {
    header: 'AWB NO.',
    accessor: (p: ReturnManifestParcel) => (
      <Link to={`/orders/track/${p.trackingId}`} className="tracking-id-link">{p.trackingId}</Link>
    ),
    width: '150px',
    className: 'return-manifest-tracking-cell',
  },
  {
    header: 'RECEIVER',
    accessor: (p: ReturnManifestParcel) => p.receiverName || '-',
    width: '150px',
  },
  {
    // The printed sheet gives the contact its own column rather than tucking it
    // under the name, and this table is meant to read the same - whoever is
    // chasing an undelivered parcel reads down a column of numbers, not across.
    header: 'CONTACT',
    accessor: (p: ReturnManifestParcel) => (
      p.receiverPhone
        ? <a className="return-contact-link" href={`tel:${p.receiverPhone}`}>{p.receiverPhone}</a>
        : <span className="return-muted">-</span>
    ),
    width: '140px',
  },
  { header: 'ADDRESS', accessor: (p: ReturnManifestParcel) => p.address || p.destination || '-', width: '220px' },
  { header: 'PCS', accessor: (p: ReturnManifestParcel) => p.pieces, width: '60px' },
  { header: 'WEIGHT', accessor: (p: ReturnManifestParcel) => (p.weightKg ? `${p.weightKg} Kg` : '-'), width: '90px' },
  { header: 'COD', accessor: (p: ReturnManifestParcel) => formatMoney(p.codAmount), width: '100px' },
  {
    header: 'STATUS',
    accessor: (p: ReturnManifestParcel) => (
      <StatusChip tone={p.status === 'returned_to_vendor' ? 'success' : 'neutral'}>
        {STATUS_LABELS[p.status as ParcelStatus] || p.status}
      </StatusChip>
    ),
    width: '160px',
  },
];

const ReturnOperations: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<ReturnTab>(() => {
    const fromUrl = searchParams.get('tab');
    return fromUrl && fromUrl in TAB_LABELS ? (fromUrl as ReturnTab) : 'follow_up';
  });
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [actionMsg, setActionMsg] = useState('');
  const [acting, setActing] = useState(false);
  // Rider-assignment popup, opened when a manifest is handed over.
  const [riderModalOpen, setRiderModalOpen] = useState(false);
  const [remarkPopupOrder, setRemarkPopupOrder] = useState<Order | null>(null);

  // ── Manifests ───────────────────────────────────────────────────────────────
  // Kept apart from `orders` and paged by the server. The parcel sweeps above
  // walk every return order into memory and stop at a ceiling; manifests are a
  // small, naturally-paged list and shouldn't inherit that limit.
  const [manifests, setManifests] = useState<ReturnManifest[]>([]);
  // Every open/sent manifest, regardless of the tab's status filter - this is
  // what lets a parcel row show which manifest it is on.
  const [liveManifests, setLiveManifests] = useState<ReturnManifest[]>([]);
  const [manifestMeta, setManifestMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [manifestPage, setManifestPage] = useState(1);
  // Manifests are keyed by vendor, so "show me this vendor's hand-overs" is the
  // question this list gets asked most. Filtered server-side (vendorId), unlike
  // the parcel tabs' text search, which runs over the sweep already in memory.
  const [manifestVendorId, setManifestVendorId] = useState('');
  // The picker only knows a vendor's name while that vendor sits in its last
  // fetched page, so the label for the current selection is kept here instead.
  const [manifestVendorLabel, setManifestVendorLabel] = useState('');
  const vendorLabelsRef = useRef<Map<string, string>>(new Map());
  const [manifestsLoading, setManifestsLoading] = useState(true);
  // One open drill-down at a time, matching the Details accordion on Pickup
  // Operations - two half-read panels stacked on screen help nobody.
  const [expandedManifestId, setExpandedManifestId] = useState('');
  const [selectedManifestIds, setSelectedManifestIds] = useState<Set<string | number>>(new Set());
  // Full manifests (with their parcels), fetched on demand and kept. The list
  // endpoint only carries member *ids*, and only for live manifests - a
  // received one would otherwise drill down into nothing.
  const [manifestDetails, setManifestDetails] = useState<Record<string, ReturnManifestDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState('');
  // Parcels ticked inside the open drill-down, for taking them back off the
  // manifest. Scoped to whichever manifest is expanded, so it resets on switch.
  const [selectedParcelIds, setSelectedParcelIds] = useState<Set<string | number>>(new Set());
  const [addToManifestOpen, setAddToManifestOpen] = useState(false);

  // The follow_up/ready_to_return/sent_to_vendor/returned_to_vendor split
  // depends on orderType *and* status together (see returnStage below), which
  // the backend's status[] filter can't express as a single query - so this
  // runs two exhaustive sweeps (by status, by orderType) and merges them,
  // rather than relying on the backend's capped (200-row, company-wide)
  // unfiltered list default, which silently drops older return orders.
  const loadReturns = async () => {
    setLoading(true);
    try {
      const [byStatus, byType] = await Promise.all([
        fetchAllPages({ status: RETURN_STATUS_FILTER }),
        fetchAllPages({ orderType: 'return' }),
      ]);
      const merged = new Map<string, Order>();
      for (const order of byStatus.all) merged.set(order.id, order);
      for (const order of byType.all) merged.set(order.id, order);
      setOrders(Array.from(merged.values()).filter((order) => returnStage(order) !== null));
      setTruncated(byStatus.truncated || byType.truncated);
      setLoadError('');
    } catch {
      setLoadError('Failed to load return orders. Showing the last loaded data, if any.');
    } finally {
      setLoading(false);
    }
  };

  // Memoised: SearchableSelectAsync re-runs its debounced fetch whenever this
  // identity changes, so an inline arrow would refetch on every render.
  const handleVendorSearch = useCallback(
    async (search: string, offset: number): Promise<SearchableSelectAsyncResult> => {
      const res = await searchVendors(search, 50, offset);
      if (!res?.success || !Array.isArray(res.data)) return { results: [], hasMore: false };
      const results: SearchableSelectAsyncOption[] = res.data.map((vendor: { id: string; label: string }) => ({
        id: vendor.id,
        label: vendor.label,
      }));
      // Remember the names on the way past - onChange only hands back an id.
      results.forEach((option) => vendorLabelsRef.current.set(option.id, option.label));
      return { results, hasMore: res.hasMore ?? false };
    },
    [],
  );

  const selectManifestVendor = useCallback((vendorId: string) => {
    setManifestVendorId(vendorId);
    setManifestVendorLabel(vendorId ? vendorLabelsRef.current.get(vendorId) ?? '' : '');
    setManifestPage(1);
  }, []);

  // Manifests come from their own paged endpoint. The list always fetches the
  // live ones too, unfiltered, because the parcel tabs badge their rows off that
  // membership - see manifestByParcelId. Only the listed page narrows to the
  // chosen vendor.
  const loadManifests = useCallback(async () => {
    setManifestsLoading(true);
    try {
      // One page each is ample for the live sweeps: 'open' is capped at one per
      // vendor by the database, and 'sent' only holds hand-overs still in a
      // rider's hands.
      const [listed, open, sent] = await Promise.all([
        getReturnManifests({
          page: manifestPage,
          pageSize: MANIFEST_PAGE_SIZE,
          ...(manifestVendorId ? { vendorId: manifestVendorId } : {}),
        }),
        getReturnManifests({ pageSize: 200, status: 'open' }),
        getReturnManifests({ pageSize: 200, status: 'sent' }),
      ]);

      if (listed?.success) {
        setManifests(listed.data);
        setManifestMeta({
          page: listed.meta.page,
          totalPages: Math.max(1, listed.meta.totalPages),
          total: listed.meta.total,
        });
      }
      setLiveManifests([...(open?.data ?? []), ...(sent?.data ?? [])]);
    } catch {
      // Non-fatal: the parcel tabs still work, they just lose the manifest badge.
    } finally {
      setManifestsLoading(false);
    }
  }, [manifestPage, manifestVendorId]);

  useEffect(() => { loadReturns(); }, []);
  useEffect(() => { void loadManifests(); }, [loadManifests]);
  // Manifests are paged by the server, so a selection can't span pages the way
  // the parcel tabs' can - clear it rather than let it sit on rows nobody sees.
  useEffect(() => {
    setSelectedManifestIds(new Set());
    setExpandedManifestId('');
  }, [manifestPage, manifestVendorId]);
  useEffect(() => subscribeToOrderStatusChanged(loadReturns), []);
  useEffect(() => { setPage(1); setSelectedIds(new Set()); setActionMsg(''); }, [activeTab, searchQuery, pageSizeChoice]);

  // Keep tab/search bookmarkable - mirror into the URL (replacing history,
  // not pushing, so the back button doesn't step through every keystroke).
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeTab !== 'follow_up') next.set('tab', activeTab);
    if (searchQuery) next.set('search', searchQuery);
    setSearchParams(next, { replace: true });
  }, [activeTab, searchQuery, setSearchParams]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((order) => {
      if (returnStage(order) !== activeTab) return false;
      if (!q) return true;
      return (
        order.trackingId.toLowerCase().includes(q) ||
        order.senderName.toLowerCase().includes(q) ||
        order.receiverName.toLowerCase().includes(q) ||
        // The order id as the table shows it, with or without the leading "#".
        `#${order.orderNumber}`.includes(q.startsWith('#') ? q : `#${q}`)
      );
    });
  }, [orders, activeTab, searchQuery]);

  // Which manifest each parcel is on, so every parcel tab can show the
  // hand-over it travelled with. Only live manifests contribute - a received
  // one is closed history the tables have no action for.
  const manifestByParcelId = useMemo(() => {
    const map = new Map<string, ReturnManifest>();
    for (const manifest of liveManifests) {
      for (const parcelId of manifest.parcelIds ?? []) map.set(parcelId, manifest);
    }
    return map;
  }, [liveManifests]);

  const tabCounts = useMemo(() => {
    const counts: Record<ReturnTab, number> = {
      follow_up: 0,
      ready_to_return: 0,
      manifests: manifestMeta.total,
      sent_to_vendor: 0,
      returned_to_vendor: 0,
    };
    for (const order of orders) {
      const stage = returnStage(order);
      if (stage) counts[stage]++;
    }
    return counts;
  }, [orders, manifestMeta.total]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSizeChoice));
  const visibleOrders = filteredOrders.slice((page - 1) * pageSizeChoice, page * pageSizeChoice);
  const visibleOrderIds = visibleOrders.map((order) => order.id);
  const allVisibleSelected = visibleOrderIds.length > 0 && visibleOrderIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleOrderIds.some((id) => selectedIds.has(id));

  const toggleRowSelection = (orderId: string | number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleOrderIds.forEach((id) => next.delete(id));
      else visibleOrderIds.forEach((id) => next.add(id));
      return next;
    });
  };

  // Advance selected RTO parcels to the next stage. Only items currently in one
  // of `sourceStatuses` are eligible (server rejects invalid transitions), so we
  // pre-filter to avoid failing the whole batch.
  const advance = async (target: ParcelStatus, sourceStatuses: ParcelStatus[]) => {
    // Filtered over the whole tab, not just the visible page: selection survives
    // paging, so scoping this to `visibleOrders` silently dropped everything the
    // operator ticked on an earlier page.
    const eligible = filteredOrders
      .filter((o) => selectedIds.has(o.id) && sourceStatuses.includes(o.status))
      .map((o) => o.id);
    if (eligible.length === 0) {
      setActionMsg('Select one or more orders in the return flow to action.');
      return;
    }
    setActing(true);
    setActionMsg('');
    try {
      await bulkUpdateOrderStatus(eligible, target);
      setSelectedIds(new Set());
      await loadReturns();
    } catch (err: any) {
      setActionMsg(err.response?.data?.message || 'Action failed.');
    } finally {
      setActing(false);
    }
  };

  // Parcels reach the vendor only by way of a manifest, so this is the single
  // entry point out of ready_to_return. Selections are narrowed to rows that are
  // genuinely at ready_to_return first: the tab also shows order_type='return'
  // reverse shipments, which are a forward delivery leg *to* the vendor and have
  // no business on a return hand-over.
  const manifestCandidates = useMemo(
    () => filteredOrders.filter((o) => selectedIds.has(o.id) && o.status === 'ready_to_return'),
    [filteredOrders, selectedIds],
  );

  const openAddToManifest = () => {
    if (manifestCandidates.length === 0) {
      setActionMsg('Select one or more orders that are actually "ready to return" first.');
      return;
    }
    const skipped = selectedIds.size - manifestCandidates.length;
    setActionMsg(
      skipped > 0
        ? `${skipped} selected order${skipped === 1 ? ' is' : 's are'} not ready to return and will be left out.`
        : '',
    );
    setAddToManifestOpen(true);
  };

  const handleManifestAdded = async (message: string) => {
    setActionMsg(message);
    setSelectedIds(new Set());
    await Promise.all([loadReturns(), loadManifests()]);
  };

  // Selected manifests, split by what can actually be done to them - a mixed
  // selection is fine, each button just acts on the half it applies to.
  const selectedManifests = useMemo(
    () => manifests.filter((m) => selectedManifestIds.has(m.id)),
    [manifests, selectedManifestIds],
  );
  const sendableManifests = selectedManifests.filter((m) => m.status === 'open' && m.parcelCount > 0);
  const receivableManifests = selectedManifests.filter((m) => m.status === 'sent');

  const openSendManifests = () => {
    if (sendableManifests.length === 0) {
      setActionMsg('Select one or more open manifests that have parcels on them.');
      return;
    }
    setActionMsg('');
    setRiderModalOpen(true);
  };

  // One call per manifest: each is its own vendor hand-over with its own parcel
  // batch, and the API moves a manifest as a unit. Sequential rather than in
  // parallel so a failure part-way names the manifest that broke instead of
  // leaving the operator to guess which of five requests it was.
  const confirmSendManifests = async (riderId: string) => {
    if (!riderId || sendableManifests.length === 0) return;
    setActing(true);
    setActionMsg('');

    const sent: string[] = [];
    const leftBehind: string[] = [];
    let failure = '';

    for (const manifest of sendableManifests) {
      try {
        const res = await sendReturnManifest(manifest.id, riderId);
        sent.push(manifest.manifestNo);
        leftBehind.push(...res.data.skipped.map((s) => s.trackingId));
      } catch (err) {
        failure = `${manifest.manifestNo}: ${apiErrorMessage(err, 'failed to send')}`;
        break;
      }
    }

    setRiderModalOpen(false);
    setSelectedManifestIds(new Set());
    // The hand-over just moved every member parcel, so the cached details are
    // stale - drop them and let the next expand or download re-fetch.
    setManifestDetails({});
    setActionMsg(
      [
        sent.length ? `Sent to vendor: ${sent.join(', ')}.` : '',
        leftBehind.length ? `Left behind: ${leftBehind.join(', ')}.` : '',
        failure,
      ].filter(Boolean).join(' '),
    );
    await Promise.all([loadReturns(), loadManifests()]);
    setActing(false);
  };

  const markManifestsReceived = async () => {
    if (receivableManifests.length === 0) {
      setActionMsg('Select one or more manifests that are out with a rider.');
      return;
    }
    setActing(true);
    setActionMsg('');

    const received: string[] = [];
    const leftBehind: string[] = [];
    let failure = '';

    for (const manifest of receivableManifests) {
      try {
        const res = await receiveReturnManifest(manifest.id);
        received.push(manifest.manifestNo);
        leftBehind.push(...res.data.skipped.map((s) => s.trackingId));
      } catch (err) {
        failure = `${manifest.manifestNo}: ${apiErrorMessage(err, 'failed to mark received')}`;
        break;
      }
    }

    setSelectedManifestIds(new Set());
    setManifestDetails({});
    setActionMsg(
      [
        received.length ? `Received by vendor: ${received.join(', ')}.` : '',
        leftBehind.length ? `Left behind: ${leftBehind.join(', ')}.` : '',
        failure,
      ].filter(Boolean).join(' '),
    );
    await Promise.all([loadReturns(), loadManifests()]);
    setActing(false);
  };

  const toggleManifestSelection = (manifestId: string | number) => {
    setSelectedManifestIds((prev) => {
      const next = new Set(prev);
      if (next.has(manifestId)) next.delete(manifestId);
      else next.add(manifestId);
      return next;
    });
  };

  const toggleAllManifests = () => {
    setSelectedManifestIds((prev) => {
      const allSelected = manifests.length > 0 && manifests.every((m) => prev.has(m.id));
      return allSelected ? new Set() : new Set(manifests.map((m) => m.id));
    });
  };

  // Fetched once per manifest and cached: the parcels on a hand-over don't
  // change while it sits on screen, and re-fetching on every expand would make
  // the accordion feel slower the more you use it. Refreshed wholesale after a
  // send/receive, since those do change the member statuses.
  const loadManifestDetail = useCallback(async (manifestId: string) => {
    if (manifestDetails[manifestId]) return manifestDetails[manifestId];
    setDetailLoadingId(manifestId);
    try {
      const res = await getReturnManifest(manifestId);
      if (res?.success) {
        setManifestDetails((prev) => ({ ...prev, [manifestId]: res.data }));
        return res.data;
      }
    } catch (err) {
      setActionMsg(apiErrorMessage(err, 'Could not load the parcels on that manifest.'));
    } finally {
      setDetailLoadingId('');
    }
    return null;
  }, [manifestDetails]);

  const toggleManifestExpanded = (manifestId: string) => {
    const opening = expandedManifestId !== manifestId;
    setExpandedManifestId(opening ? manifestId : '');
    setSelectedParcelIds(new Set());
    if (opening) void loadManifestDetail(manifestId);
  };

  const toggleParcelSelection = (parcelId: string | number) => {
    setSelectedParcelIds((prev) => {
      const next = new Set(prev);
      if (next.has(parcelId)) next.delete(parcelId);
      else next.add(parcelId);
      return next;
    });
  };

  const toggleAllParcels = (parcels: ReturnManifestParcel[]) => {
    setSelectedParcelIds((prev) => {
      const allSelected = parcels.length > 0 && parcels.every((p) => prev.has(p.id));
      return allSelected ? new Set() : new Set(parcels.map((p) => p.id));
    });
  };

  // Takes parcels back off an open manifest. They stay at ready_to_return, so
  // they drop straight back into that tab ready to join another hand-over -
  // this only unpicks the grouping, it never touches a parcel's status.
  const removeSelectedParcels = async (manifest: ReturnManifest) => {
    const detail = manifestDetails[manifest.id];
    const targets = detail?.parcels.filter((p) => selectedParcelIds.has(p.id)) ?? [];
    if (targets.length === 0) return;

    setActing(true);
    setActionMsg('');

    const removed: string[] = [];
    let failure = '';
    let latest: ReturnManifestDetail | null = null;

    for (const parcel of targets) {
      try {
        const res = await removeParcelFromReturnManifest(manifest.id, parcel.id);
        removed.push(parcel.trackingId);
        latest = res.data;
      } catch (err) {
        failure = `${parcel.trackingId}: ${apiErrorMessage(err, 'could not be removed')}`;
        break;
      }
    }

    if (latest) setManifestDetails((prev) => ({ ...prev, [manifest.id]: latest! }));
    setSelectedParcelIds(new Set());
    setActionMsg(
      [
        removed.length ? `Removed from ${manifest.manifestNo}: ${removed.join(', ')}.` : '',
        failure,
      ].filter(Boolean).join(' '),
    );
    // The parcels are back in the ready-to-return pool, and the manifest's
    // count on the row above has changed - both lists need refreshing.
    await Promise.all([loadReturns(), loadManifests()]);
    setActing(false);
  };

  const printManifests = async () => {
    if (selectedManifests.length === 0) {
      setActionMsg('Select the manifests you want to print.');
      return;
    }
    setActing(true);
    setActionMsg('');
    try {
      // Sequential so a slow list doesn't fire a dozen parallel requests, and
      // so the document is built in the order shown on screen.
      const details: ReturnManifestDetail[] = [];
      for (const manifest of selectedManifests) {
        const detail = await loadManifestDetail(manifest.id);
        if (detail) details.push(detail);
      }
      await printReturnManifests(details);
    } finally {
      setActing(false);
    }
  };

  const downloadCsv = () => {
    // Mirrors the table on screen, where the Last Updated cell shows who and
    // when - two things, so two columns here rather than one.
    const headers = ['Order ID', 'Date', 'Tracking ID', 'Type', 'Vendor', 'Manifest', 'Sender', 'Receiver', 'Location', 'Address', 'Weight', 'COD', 'Status', 'Last Updated By', 'Last Updated', 'Remarks', ...STATUS_TIMELINE_HEADERS];
    const rows = filteredOrders.map((order) => [
      `#${order.orderNumber}`,
      toBsDateTimeCell(order.createdAtRaw || order.createdAt) || '',
      order.trackingId,
      order.orderType === 'return' ? 'Return order' : 'RTV',
      order.vendorName || '',
      manifestByParcelId.get(order.id)?.manifestNo || '',
      order.senderName,
      order.receiverName,
      order.destination,
      order.receiverAddress || '',
      order.weightKg ? `${order.weightKg} Kg` : '',
      order.codAmount,
      STATUS_LABELS[order.status] || order.status,
      order.lastUpdatedBy || '',
      toBsDateTimeCell(order.lastUpdatedAt) || '',
      order.remarks || '',
      ...statusTimelineCells(order.statusTimestamps),
    ]);
    downloadExcel('return-orders.xlsx', 'Return Orders', headers, rows);
  };

  const selectedOrders = visibleOrders.filter((o) => selectedIds.has(o.id));

  const handlePrintLabels = () => {
    const labelOrders = selectedOrders.length > 0 ? selectedOrders : visibleOrders;
    void printLabels(labelOrders);
  };

  const returnColumns = [
    {
      header: 'ORDER ID',
      accessor: (order: Order) => `#${order.orderNumber}`,
      width: '70px',
      className: 'return-sn-cell',
    },
    { header: 'DATE', accessor: (order: Order) => toBsDate(order.createdAt) || '-', width: '100px' },
    {
      header: 'TRACKING ID',
      accessor: (order: Order) => (
        <Link to={`/orders/track/${order.trackingId}`} className="tracking-id-link">{order.trackingId}</Link>
      ),
      width: '124px',
      className: 'return-tracking-cell',
    },
    {
      header: 'TYPE',
      accessor: (order: Order) => (
        <StatusChip tone={order.orderType === 'return' ? 'info' : 'warning'}>
          {order.orderType === 'return' ? 'Return order' : 'RTV'}
        </StatusChip>
      ),
      width: '140px',
    },
    {
      // Manifests are keyed by vendor, so grouping a selection without seeing
      // the vendor was guesswork - the sender name is the shop's own identity,
      // not necessarily the account the parcel bills to.
      header: 'VENDOR',
      accessor: (order: Order) => order.vendorName || <span className="return-muted">No vendor</span>,
      width: '170px',
    },
    {
      header: 'MANIFEST',
      accessor: (order: Order) => {
        const manifest = manifestByParcelId.get(order.id);
        if (manifest) {
          return (
            <StatusChip tone={manifest.status === 'open' ? 'info' : 'neutral'}>{manifest.manifestNo}</StatusChip>
          );
        }
        // An order_type='return' parcel sits in these tabs while its real status
        // is a forward pickup leg, so it can never join a return manifest. Say
        // so, rather than letting the operator select it and be refused.
        if (order.orderType === 'return') {
          return <span className="return-muted" title="This is a return order being delivered to the vendor, not an RTO">Not applicable</span>;
        }
        return <span className="return-muted">-</span>;
      },
      // A manifest no is a fixed 23 characters (RTM-YYMMDD-<10>-<check>), and
      // the chip can't wrap - at 170px it spilled out of the cell and over the
      // sender beside it. 210px is what the Manifests tab gives the same string.
      width: '210px',
    },
    {
      header: 'SENDER',
      accessor: (order: Order) => (
        <div className="return-party-cell"><span>{order.senderName}</span><small>{order.senderPhone}</small></div>
      ),
      width: '200px',
    },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div className="return-party-cell"><span>{order.receiverName}</span><small>{order.receiverPhone}</small></div>
      ),
      width: '200px',
    },
    {
      header: 'LOCATION',
      // Destination hub plus the receiver's street address - riders and hub
      // staff need both to route a parcel, not just the hub name.
      accessor: (order: Order) => (
        <div className="return-location-cell">
          <span>{order.destination || '-'}</span>
          {order.receiverAddress && <small title={order.receiverAddress}>{order.receiverAddress}</small>}
        </div>
      ),
      width: '180px',
    },
    { header: 'WEIGHT', accessor: (order: Order) => (order.weightKg ? `${order.weightKg} Kg` : '-'), width: '80px' },
    { header: 'COD', accessor: (order: Order) => formatMoney(order.codAmount), width: '113px' },
    {
      header: 'STATUS',
      accessor: (order: Order) => (
        <StatusChip tone={order.status === 'returned_to_vendor' ? 'success' : 'neutral'}>
          {STATUS_LABELS[order.status] || order.status}
        </StatusChip>
      ),
      width: '170px',
    },
    {
      header: 'LAST UPDATED',
      accessor: (order: Order) => (
        <div className="return-updated-cell">
          <span>{order.lastUpdatedBy || '-'}</span>
          <span>{toBsDateTime(order.lastUpdatedAt) || '-'}</span>
        </div>
      ),
      width: '155px',
    },
    {
      header: 'REMARKS',
      accessor: (order: Order) => (
        <button
          type="button"
          className="return-remarks-cell-btn"
          onClick={() => setRemarkPopupOrder(order)}
          title={order.remarks || 'Add remark'}
        >
          {order.remarks || '-'}
        </button>
      ),
      width: '160px',
      className: 'return-remarks-cell',
    },
  ];

  const manifestColumns = [
    {
      header: 'MANIFEST NO',
      accessor: (manifest: ReturnManifest) => <span className="return-manifest-no">{manifest.manifestNo}</span>,
      width: '210px',
    },
    {
      header: 'VENDOR',
      accessor: (manifest: ReturnManifest) => (
        <div className="return-party-cell"><span>{manifest.vendorName}</span><small>{manifest.vendorPhone}</small></div>
      ),
      width: '200px',
    },
    { header: 'PARCELS', accessor: (manifest: ReturnManifest) => manifest.parcelCount, width: '90px' },
    {
      header: 'STATUS',
      accessor: (manifest: ReturnManifest) => (
        <StatusChip tone={manifest.status === 'received' ? 'success' : manifest.status === 'sent' ? 'warning' : 'info'}>
          {RETURN_MANIFEST_STATUS_LABELS[manifest.status]}
        </StatusChip>
      ),
      width: '150px',
    },
    {
      header: 'RIDER',
      accessor: (manifest: ReturnManifest) =>
        manifest.riderName ? (
          <div className="return-party-cell"><span>{manifest.riderName}</span><small>{manifest.riderVehicleNo || manifest.riderPhone}</small></div>
        ) : (
          <span className="return-muted">-</span>
        ),
      width: '170px',
    },
    { header: 'CREATED', accessor: (manifest: ReturnManifest) => toBsDateTime(manifest.createdAt) || '-', width: '150px' },
    { header: 'SENT', accessor: (manifest: ReturnManifest) => toBsDateTime(manifest.sentAt) || '-', width: '150px' },
    { header: 'RECEIVED', accessor: (manifest: ReturnManifest) => toBsDateTime(manifest.receivedAt) || '-', width: '150px' },
    {
      header: 'ACTION',
      accessor: (manifest: ReturnManifest) => (
        <Button variant="primary" onClick={() => toggleManifestExpanded(manifest.id)}>
          {expandedManifestId === manifest.id ? <><ChevronUp size={14} /> Details</> : <><ChevronDown size={14} /> Details</>}
        </Button>
      ),
      width: '130px',
    },
  ];

  // The drill-down panel: a nested Table inside the expanded row, the same
  // pattern Pickup Operations uses for a pickup's orders. Fed from the manifest
  // detail endpoint rather than the parcels already in memory, so a received
  // manifest - whose membership the list endpoint deliberately omits - still
  // opens onto its contents.
  const renderManifestParcels = (manifest: ReturnManifest) => {
    const detail = manifestDetails[manifest.id];

    if (!detail) {
      return (
        <p className="return-manifest-empty">
          {detailLoadingId === manifest.id ? 'Loading parcels…' : 'Could not load the parcels on this manifest.'}
        </p>
      );
    }
    if (detail.parcels.length === 0) {
      return <p className="return-manifest-empty">No parcels on this manifest yet.</p>;
    }

    const allSelected = detail.parcels.every((p) => selectedParcelIds.has(p.id));
    const someSelected = detail.parcels.some((p) => selectedParcelIds.has(p.id));

    return (
      <div className="return-manifest-panel">
        {/* Parcels can only leave a manifest while it is still open - once it has
            gone out with a rider its contents are a record of what was handed
            over, not a list to edit. */}
        {manifest.status === 'open' && (
          <div className="return-manifest-panel-bar">
            <span className="return-muted">
              {someSelected
                ? `${detail.parcels.filter((p) => selectedParcelIds.has(p.id)).length} selected`
                : 'Tick parcels to take them off this manifest.'}
            </span>
            <Button
              variant="secondary"
              disabled={acting || !someSelected}
              onClick={() => removeSelectedParcels(manifest)}
            >
              <X size={14} /> Remove from manifest
            </Button>
          </div>
        )}

        <Table
          columns={manifestParcelColumns(detail.parcels)}
          data={detail.parcels}
          selectable={manifest.status === 'open'}
          selectedIds={selectedParcelIds}
          onToggleRow={toggleParcelSelection}
          allSelected={allSelected}
          someSelected={someSelected}
          onToggleAll={() => toggleAllParcels(detail.parcels)}
          minWidth="1280px"
          tableClassName="return-manifest-table"
          emptyMessage="No parcels on this manifest."
        />
      </div>
    );
  };

  const noSelection = selectedIds.size === 0 || acting;
  const showingManifests = activeTab === 'manifests';

  // One rider carries the whole selection, so name what they are picking up.
  const sendManifestDescription = sendableManifests.length === 1
    ? `Pick the rider who will carry ${sendableManifests[0]!.manifestNo} (${sendableManifests[0]!.parcelCount} parcel${sendableManifests[0]!.parcelCount === 1 ? '' : 's'}) back to ${sendableManifests[0]!.vendorName}.`
    : `Pick the rider who will carry ${sendableManifests.length} manifests (${sendableManifests.reduce((sum, m) => sum + m.parcelCount, 0)} parcels) back to their vendors.`;

  return (
    <div className="return-operations-container">
      <PageHeader title="Return" subtitle="Manage return orders and failed deliveries going back to the vendor." />

      <SegmentedTabs
        ariaLabel="Return operation filters"
        value={activeTab}
        onChange={setActiveTab}
        options={(Object.keys(TAB_LABELS) as ReturnTab[]).map((tab) => ({ value: tab, label: TAB_LABELS[tab], count: tabCounts[tab] }))}
      />

      {loadError && <p className="return-action-msg">{loadError}</p>}
      {truncated && (
        <p className="return-action-msg">
          Showing a partial list - there are more return orders than could be loaded. Narrow your search to find a specific order.
        </p>
      )}

      <div className="return-toolbar">
        {showingManifests ? (
          <div className="return-vendor-filter">
            <SearchableSelectAsync
              asyncSearch={handleVendorSearch}
              value={manifestVendorId}
              onChange={selectManifestVendor}
              initialLabel={manifestVendorLabel}
              placeholder="All vendors"
              searchPlaceholder="Search vendor by name..."
              emptyMessage="No vendors found."
            />
            {/* The picker itself has no way back to "all" once a vendor is
                chosen, and the filter is server-side, so an empty result is a
                dead end without this. */}
            {manifestVendorId && (
              <button
                type="button"
                className="return-vendor-filter-clear"
                onClick={() => selectManifestVendor('')}
                aria-label="Clear vendor filter"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ) : (
          <div />
        )}
        <div className="return-toolbar-actions">
          {activeTab === 'follow_up' && (
            <>
              <Button variant="secondary" disabled={noSelection} onClick={() => advance('ready_to_deliver', ['failed_delivery', 'follow_up'])}>
                Reattempt delivery
              </Button>
              <Button variant="primary" disabled={noSelection} onClick={() => advance('ready_to_return', ['failed_delivery', 'follow_up'])}>
                Mark for return
              </Button>
            </>
          )}
          {activeTab === 'ready_to_return' && (
            <Button variant="primary" disabled={noSelection} onClick={openAddToManifest}>
              Add to manifest
            </Button>
          )}
          {showingManifests && (
            <>
              <Button variant="primary" disabled={acting || sendableManifests.length === 0} onClick={openSendManifests}>
                Send to vendor{sendableManifests.length > 1 ? ` (${sendableManifests.length})` : ''}
              </Button>
              <Button variant="secondary" disabled={acting || receivableManifests.length === 0} onClick={markManifestsReceived}>
                Mark received{receivableManifests.length > 1 ? ` (${receivableManifests.length})` : ''}
              </Button>
              <Button variant="secondary" disabled={acting || selectedManifests.length === 0} onClick={printManifests}>
                <Printer size={14} /> Print{selectedManifests.length > 1 ? ` (${selectedManifests.length})` : ''}
              </Button>
            </>
          )}
          {!showingManifests && (
            <>
              <Button variant="secondary" onClick={downloadCsv}><Download size={14} /> Download</Button>
              <Button variant="secondary" onClick={handlePrintLabels} disabled={visibleOrders.length === 0}>
                <Printer size={14} /> {selectedOrders.length > 0 ? `Print ${selectedOrders.length} Selected` : `Print All (${visibleOrders.length})`}
              </Button>
            </>
          )}
        </div>
      </div>

      {actionMsg && <p className="return-action-msg">{actionMsg}</p>}

      {!showingManifests && (
        <label className="return-search">
          <Search size={16} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search tracking id or #2980"
          />
        </label>
      )}

      {showingManifests ? (
        <>
          <Table
            columns={manifestColumns}
            data={manifests}
            selectedIds={selectedManifestIds}
            onToggleRow={toggleManifestSelection}
            allSelected={manifests.length > 0 && manifests.every((m) => selectedManifestIds.has(m.id))}
            someSelected={manifests.some((m) => selectedManifestIds.has(m.id))}
            onToggleAll={toggleAllManifests}
            getRowClassName={(manifest) => (manifest.id === expandedManifestId ? 'return-row-active' : '')}
            expandedRowId={expandedManifestId}
            renderExpandedRow={renderManifestParcels}
            loading={manifestsLoading}
            loadingMessage="Loading return manifests..."
            emptyMessage="No return manifests yet. Build one from the Ready to return tab."
            minWidth="1570px"
            tableClassName="return-table"
          />

          <Pagination
            ariaLabel="Return manifest pagination"
            page={manifestMeta.page}
            totalPages={manifestMeta.totalPages}
            onPageChange={setManifestPage}
            pageSize={MANIFEST_PAGE_SIZE}
            pageSizeLabel="manifests"
            summary={`${manifestMeta.total} manifest${manifestMeta.total === 1 ? '' : 's'}`}
          />
        </>
      ) : (
        <>
          <Table
            columns={returnColumns}
            data={visibleOrders}
            selectedIds={selectedIds}
            onToggleRow={toggleRowSelection}
            allSelected={allVisibleSelected}
            someSelected={someVisibleSelected}
            onToggleAll={toggleVisibleSelection}
            loading={loading}
            loadingMessage="Loading return orders..."
            emptyMessage="No return orders in this stage."
            minWidth="2120px"
            tableClassName="return-table"
          />

          <Pagination
            ariaLabel="Return pagination"
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={pageSizeChoice}
            pageSizeLabel="return orders"
            onPageSizeChange={setPageSizeChoice}
            summary={`${filteredOrders.length} order${filteredOrders.length === 1 ? '' : 's'}`}
          />
        </>
      )}

      <AddToReturnManifestModal
        isOpen={addToManifestOpen}
        orders={manifestCandidates}
        onClose={() => setAddToManifestOpen(false)}
        onAdded={handleManifestAdded}
      />

      <RiderAssignModal
        isOpen={riderModalOpen}
        title="Assign rider"
        description={sendManifestDescription}
        confirmLabel={sendableManifests.length > 1 ? 'Send manifests' : 'Send manifest'}
        busy={acting}
        error={actionMsg}
        onClose={() => setRiderModalOpen(false)}
        onConfirm={confirmSendManifests}
      />

      {remarkPopupOrder && (
        <QuickRemarkPopup
          orderId={remarkPopupOrder.id}
          trackingId={remarkPopupOrder.trackingId}
          onClose={() => setRemarkPopupOrder(null)}
        />
      )}
    </div>
  );
};

export default ReturnOperations;
