import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Search, X } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Table from '../components/Table';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import FilterDropdown from '../components/FilterDropdown';
import Button from '../components/Button';
import {
  getAuditLogFilterOptions,
  getAuditLogs,
  type AuditLog,
  type AuditLogsPageMeta,
} from '../services/auditLog.service';
import { toBsDate, toNptTime } from '../utils/nepaliDate';
import './SystemLogs.css';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

type DateRange = '' | 'today' | '7d' | '30d';

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const RANGE_DAYS: Record<Exclude<DateRange, ''>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
};

const dateRangeToIso = (range: DateRange): { fromDate?: string; toDate?: string } => {
  if (!range) return {};
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (RANGE_DAYS[range] - 1));
  return { fromDate: cutoff.toISOString() };
};

const humanize = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const ACTION_TONE: Record<string, StatusChipTone> = {
  CREATE: 'success',
  PAY: 'success',
  UPDATE: 'info',
  HANDOFF: 'info',
  BULK: 'warning',
  DELETE: 'danger',
  REJECT: 'danger',
};

const toneForAction = (action: string): StatusChipTone => {
  const key = Object.keys(ACTION_TONE).find((prefix) => action.includes(prefix));
  return key ? ACTION_TONE[key] : 'neutral';
};

const JsonBlock: React.FC<{ label: string; value: Record<string, unknown> | null }> = ({ label, value }) => (
  <div className="system-logs-json-block">
    <span className="system-logs-json-label">{label}</span>
    {value ? (
      <pre>{JSON.stringify(value, null, 2)}</pre>
    ) : (
      <span className="system-logs-json-empty">—</span>
    )}
  </div>
);

const LogDetailPanel: React.FC<{ log: AuditLog }> = ({ log }) => (
  <div className="system-logs-detail">
    <div className="system-logs-detail-meta">
      <span><strong>Entity ID</strong> {log.entityId ?? '—'}</span>
      <span><strong>IP Address</strong> {log.ipAddress ?? '—'}</span>
      <span><strong>User Agent</strong> {log.userAgent ?? '—'}</span>
    </div>
    <div className="system-logs-json-grid">
      <JsonBlock label="Before" value={log.oldData} />
      <JsonBlock label="After" value={log.newData} />
    </div>
  </div>
);

const SystemLogs: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [meta, setMeta] = useState<AuditLogsPageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [entityTypeOptions, setEntityTypeOptions] = useState<string[]>([]);
  const [actionOptions, setActionOptions] = useState<string[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('');
  const [expandedId, setExpandedId] = useState<string | number | undefined>(undefined);

  // Cursor history instead of numbered pages - audit_logs is append-only and
  // grows without bound, so this deliberately never asks the server for a
  // total row count or an arbitrary page N. "Older" walks forward through a
  // cursor the server just gave us; "Newer" just replays a cursor this page
  // already visited, so it costs nothing extra server-side.
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const currentCursor = cursorHistory[pageIndex];

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    setCursorHistory([undefined]);
    setPageIndex(0);
  }, [debouncedSearch, entityType, action, dateRange]);

  useEffect(() => {
    getAuditLogFilterOptions()
      .then((res) => {
        if (res?.success && res.data) {
          setEntityTypeOptions(res.data.entityTypes);
          setActionOptions(res.data.actions);
        }
      })
      .catch(() => {});
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAuditLogs({
        search: debouncedSearch || undefined,
        entityType: entityType || undefined,
        action: action || undefined,
        ...dateRangeToIso(dateRange),
        cursor: currentCursor,
        pageSize: PAGE_SIZE,
      });
      if (res?.success) {
        setLogs(res.data ?? []);
        setMeta(res.meta ?? null);
      }
    } catch {
      setLogs([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, entityType, action, dateRange, currentCursor]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const resetFilters = () => {
    setEntityType('');
    setAction('');
    setDateRange('');
  };

  const goNewer = () => setPageIndex((i) => Math.max(0, i - 1));
  const goOlder = () => {
    if (!meta?.nextCursor) return;
    const nextCursor = meta.nextCursor;
    setCursorHistory((prev) => [...prev.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
  };
  const hasNewer = pageIndex > 0;
  const hasOlder = !!meta?.hasNextPage;

  const entityTypeFilterOptions = useMemo(
    () => entityTypeOptions.map((value) => ({ value, label: humanize(value) })),
    [entityTypeOptions],
  );
  const actionFilterOptions = useMemo(
    () => actionOptions.map((value) => ({ value, label: humanize(value) })),
    [actionOptions],
  );

  const columns = useMemo(() => [
    {
      header: 'TIME',
      accessor: (log: AuditLog) => (
        <div className="system-logs-time-cell">
          <span>{toBsDate(log.createdAt)}</span>
          <small>{toNptTime(log.createdAt, true)}</small>
        </div>
      ),
      width: '120px',
    },
    {
      header: 'ACTOR',
      accessor: (log: AuditLog) => (
        <div className="system-logs-actor-cell">
          <span>{log.actorName ?? 'System'}</span>
          {log.actorEmail && <small>{log.actorEmail}</small>}
        </div>
      ),
      width: '180px',
    },
    {
      header: 'ACTION',
      accessor: (log: AuditLog) => (
        <StatusChip tone={toneForAction(log.action)}>{humanize(log.action)}</StatusChip>
      ),
      width: '160px',
    },
    {
      header: 'ENTITY',
      accessor: (log: AuditLog) => (
        <div className="system-logs-entity-cell">
          <span>{humanize(log.entityType)}</span>
          {log.entityId && <small title={log.entityId}>{log.entityId.slice(0, 8)}…</small>}
        </div>
      ),
      width: '160px',
    },
    {
      header: '',
      accessor: (log: AuditLog) => (
        <button
          type="button"
          className="system-logs-view-btn"
          onClick={() => setExpandedId((prev) => (prev === log.id ? undefined : log.id))}
          title="View details"
        >
          <Eye size={15} />
        </button>
      ),
      width: '48px',
    },
  ], []);

  return (
    <div className="system-logs-container">
      <PageHeader
        title="System Logs"
        subtitle="Audit trail of actions across the platform."
      />

      <div className="system-logs-filter-panel">
        <FilterDropdown
          label="ENTITY TYPE"
          value={entityType}
          onChange={setEntityType}
          placeholder="All entities"
          options={entityTypeFilterOptions}
        />
        <FilterDropdown
          label="ACTION"
          value={action}
          onChange={setAction}
          placeholder="All actions"
          options={actionFilterOptions}
        />
        <FilterDropdown
          label="DATE RANGE"
          value={dateRange}
          onChange={(value) => setDateRange(value as DateRange)}
          placeholder="All time"
          options={DATE_RANGE_OPTIONS}
        />
        <Button variant="outline" className="clear-filter-btn" onClick={resetFilters}>
          Clear Filters
        </Button>
      </div>

      <label className="system-logs-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search by action or entity type"
        />
        {searchQuery && (
          <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </label>

      <Table
        columns={columns}
        data={logs}
        loading={loading}
        loadingMessage="Loading system logs…"
        emptyMessage="No log entries found."
        minWidth="900px"
        tableClassName="system-logs-table"
        expandedRowId={expandedId}
        renderExpandedRow={(log) => <LogDetailPanel log={log} />}
      />

      <div className="system-logs-pager">
        <span className="system-logs-pager-summary">{logs.length} log{logs.length === 1 ? '' : 's'} shown</span>
        <div className="system-logs-pager-controls" aria-label="System logs pagination">
          <Button variant="outline" size="sm" onClick={goNewer} disabled={!hasNewer}>
            <ChevronLeft size={14} /> Newer
          </Button>
          <Button variant="outline" size="sm" onClick={goOlder} disabled={!hasOlder}>
            Older <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SystemLogs;
