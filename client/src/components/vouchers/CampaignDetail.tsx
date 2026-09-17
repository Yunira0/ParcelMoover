import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '../Button';
import Banner from '../Banner';
import ConfirmDialog from '../ConfirmDialog';
import FormField from '../FormField';
import Pagination from '../Pagination';
import StatusChip, { type StatusChipTone } from '../StatusChip';
import Table from '../Table';
import { toBsDate } from '../../utils/nepaliDate';
import { apiErrorMessage } from '../../utils/serverValidation';
import { printCampaignSlips } from '../../utils/voucherSlips';
import {
  campaignCsvUrl, getCampaign, listCampaignCodes, setCampaignStatus, setVoucherActive,
  type CampaignCodeRow, type CampaignCodeState, type VoucherCampaign, type VoucherOffer,
} from '../../services/voucher.service';

const STATE_TONE: Record<CampaignCodeState, StatusChipTone> = {
  unclaimed: 'neutral',
  claimed: 'info',
  redeemed: 'success',
  expired: 'neutral',
  paused: 'warning',
};

const STATE_OPTIONS = [
  { value: 'all', label: 'All states' },
  { value: 'unclaimed', label: 'Unclaimed' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'redeemed', label: 'Redeemed' },
  { value: 'expired', label: 'Expired' },
  { value: 'paused', label: 'Paused' },
];

interface CampaignDetailProps {
  campaignId: string;
  onBack: () => void;
  /** Refresh the directory after a status change here. */
  onChanged: () => void;
  /** Open the shared voucher preview (PNG download + single print) for a code. */
  onPreviewCode: (offer: VoucherOffer) => void;
}

/** One campaign: funnel stats, tracked codes, CSV + slip printing. */
export default function CampaignDetail({ campaignId, onBack, onChanged, onPreviewCode }: CampaignDetailProps) {
  const [campaign, setCampaign] = useState<VoucherCampaign | null>(null);
  const [codes, setCodes] = useState<CampaignCodeRow[]>([]);
  const [codePage, setCodePage] = useState(1);
  const [codeTotalPages, setCodeTotalPages] = useState(1);
  const [codeTotal, setCodeTotal] = useState(0);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [state, setState] = useState('all');
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim().toUpperCase()), 350);
    return () => clearTimeout(t);
  }, [q]);

  // First load shows the skeleton; later refetches (paging, filters,
  // pause/resume) update the table in place without flashing it.
  const reload = useCallback(async () => {
    setError('');
    try {
      const [c, list] = await Promise.all([
        getCampaign(campaignId),
        listCampaignCodes(campaignId, { page: codePage, q: debouncedQ || undefined, state }),
      ]);
      setCampaign(c);
      setCodes(list.data);
      setCodeTotalPages(list.totalPages);
      setCodeTotal(list.total);
      setSelected(new Set());
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the campaign.'));
    } finally {
      setLoading(false);
    }
  }, [campaignId, codePage, debouncedQ, state]);

  useEffect(() => { void reload(); }, [reload, revision]);

  const codeById = useMemo(() => new Map(codes.map(c => [c.id, c.code])), [codes]);
  const selectedCodes = useMemo(
    () => [...selected].map(id => codeById.get(String(id))).filter((c): c is string => !!c),
    [selected, codeById],
  );

  /** A clicked code opens the shared preview as that exact voucher. */
  function previewCode(row: CampaignCodeRow) {
    if (!campaign) return;
    onPreviewCode({
      id: row.id, code: row.code, title: row.title, description: row.description,
      discountType: campaign.discountType, discountAmount: campaign.discountAmount,
      discountPercent: campaign.discountPercent, maxDiscount: campaign.maxDiscount,
      minimumCharge: campaign.minimumCharge,
      startsAt: campaign.startsAt, expiresAt: campaign.expiresAt,
      claimLimit: 1, claimedCount: row.state === 'unclaimed' ? 0 : 1, isActive: row.isActive,
    });
  }

  async function changeStatus(next: 'active' | 'paused' | 'ended') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await setCampaignStatus(campaignId, next);
      setCampaign(updated);
      setConfirmEnd(false);
      setNotice(next === 'ended' ? `Campaign ${updated.name} ended.` : `Campaign ${updated.name} ${next}.`);
      onChanged();
      setRevision(v => v + 1);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not update the campaign.'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleCode(row: CampaignCodeRow) {
    setError('');
    try {
      await setVoucherActive(row.id, !row.isActive);
      setRevision(v => v + 1);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not update the code.'));
    }
  }

  async function fetchAllCodes(filterState: string): Promise<string[]> {
    const out: string[] = [];
    let page = 1;
    for (;;) {
      const res = await listCampaignCodes(campaignId, { page, state: filterState });
      out.push(...res.data.map(r => r.code));
      if (page >= res.totalPages) break;
      page += 1;
    }
    return out;
  }

  async function print(codesToPrint: string[] | null) {
    if (!campaign) return;
    setPrinting(true);
    setError('');
    try {
      const list = codesToPrint ?? (await fetchAllCodes('unclaimed'));
      await printCampaignSlips(campaign, list);
    } catch (err) {
      // apiErrorMessage only reads server responses — print failures are
      // client-side, so prefer the real Error text when there is one.
      const serverMessage = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      setError(typeof serverMessage === 'string' && serverMessage
        ? serverMessage
        : err instanceof Error && err.message
          ? err.message
          : 'Could not print the slips.');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div>
      <div className="vouchers-detail-head">
        <Button variant="secondary" size="sm" onClick={onBack}>← Back to campaigns</Button>
      </div>
      {notice && <Banner tone="success">{notice}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && <div className="billing-skeleton billing-skeleton-table" aria-busy="true" aria-label="Loading campaign" />}

      {!loading && campaign && <>
        <div className="vouchers-detail-title">
          <h2>{campaign.name}</h2>
          <StatusChip variant="solid" tone={campaign.status === 'active' ? 'success' : campaign.status === 'paused' ? 'warning' : 'neutral'}>
            {campaign.status}
          </StatusChip>
        </div>
        <dl className="vouchers-stats">
          <div><dt>Generated</dt><dd>{campaign.stats.generated}</dd></div>
          <div><dt>Claimed</dt><dd>{campaign.stats.claimed}</dd></div>
          <div><dt>Redeemed</dt><dd>{campaign.stats.redeemed}</dd></div>
          <div><dt>Expired</dt><dd>{campaign.stats.expired}</dd></div>
        </dl>
        <div className="vouchers-detail-actions">
          {campaign.status !== 'ended' && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void changeStatus(campaign.status === 'active' ? 'paused' : 'active')}>
              {campaign.status === 'active' ? 'Pause campaign' : 'Resume campaign'}
            </Button>
          )}
          {campaign.status !== 'ended' && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmEnd(true)}>
              End campaign
            </Button>
          )}
          <a className="btn btn-secondary btn-sm" href={campaignCsvUrl(campaign.id)} download>Export CSV</a>
          <Button variant="secondary" size="sm" disabled={printing} onClick={() => void print(selectedCodes.length ? selectedCodes : null)}>
            {printing ? 'Preparing…' : selectedCodes.length ? `Print ${selectedCodes.length} selected` : 'Print all unclaimed'}
          </Button>
        </div>

        <div className="vouchers-code-filters">
          <FormField label="Search codes" hideLabel value={q} onChange={v => { setQ(v.toUpperCase()); setCodePage(1); }} placeholder="Search code…" maxLength={32} />
          <FormField label="State" hideLabel type="select" value={state} onChange={v => { setState(v); setCodePage(1); }} options={STATE_OPTIONS} />
        </div>
        <Table
          columns={[
            {
              header: 'CODE',
              accessor: (r: CampaignCodeRow) => (
                <button type="button" className="voucher-code voucher-code-link" onClick={() => previewCode(r)} title={`Preview ${r.code}`}>
                  {r.code}
                </button>
              ),
            },
            {
              header: 'STATE',
              accessor: (r: CampaignCodeRow) => (
                <StatusChip variant="solid" tone={STATE_TONE[r.state]}>{r.state}</StatusChip>
              ),
            },
            { header: 'VENDOR', accessor: (r: CampaignCodeRow) => r.vendorName ?? '—' },
            { header: 'CLAIMED', accessor: (r: CampaignCodeRow) => (r.claimedAt ? toBsDate(r.claimedAt) : '—') },
            {
              header: 'ACTION',
              accessor: (r: CampaignCodeRow) => (
                <Button variant="secondary" size="sm" onClick={() => void toggleCode(r)}>
                  {r.isActive ? 'Pause' : 'Resume'}
                </Button>
              ),
              width: '110px',
            },
          ]}
          data={codes}
          selectable
          selectedIds={selected}
          onToggleRow={id => setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })}
          onToggleAll={() => setSelected(prev => (prev.size === codes.length ? new Set() : new Set(codes.map(c => c.id))))}
          allSelected={codes.length > 0 && selected.size === codes.length}
          someSelected={selected.size > 0 && selected.size < codes.length}
          emptyMessage="No codes match this filter."
        />
        <Pagination
          page={codePage}
          totalPages={codeTotalPages}
          onPageChange={setCodePage}
          ariaLabel="Campaign codes"
          summary={codeTotal > 0 ? `${codeTotal} code${codeTotal === 1 ? '' : 's'}` : undefined}
        />
      </>}

      <ConfirmDialog
        isOpen={confirmEnd}
        title={`End ${campaign?.name ?? 'this campaign'}?`}
        message="Vendors can no longer claim its codes. This cannot be undone — create a follow-up campaign instead."
        confirmLabel="End campaign"
        danger
        busy={busy}
        onConfirm={() => void changeStatus('ended')}
        onCancel={() => setConfirmEnd(false)}
      />
    </div>
  );
}
