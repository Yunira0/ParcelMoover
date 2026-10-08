import Button from '../Button';
import Pagination from '../Pagination';
import StatusChip, { type StatusChipTone } from '../StatusChip';
import Table from '../Table';
import type { VoucherCampaign } from '../../services/voucher.service';

const STATUS_TONE: Record<string, StatusChipTone> = {
  active: 'success',
  paused: 'warning',
  ended: 'neutral',
};

interface CampaignDirectoryProps {
  campaigns: VoucherCampaign[];
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
  onView: (campaign: VoucherCampaign) => void;
  onToggle: (campaign: VoucherCampaign) => void;
}

/** The campaign directory: every bulk-code campaign with live funnel stats. */
export default function CampaignDirectory({
  campaigns, page, totalPages, total, onPage, onView, onToggle,
}: CampaignDirectoryProps) {
  return (
    <>
      <Table
        columns={[
          {
            header: 'CAMPAIGN',
            accessor: (c: VoucherCampaign) => (
              <div>
                <strong>{c.name}</strong>
                <div className="vouchers-cell-sub">{c.codePrefix}-XXXXXX · {c.codeCount} codes</div>
              </div>
            ),
          },
          { header: 'CLAIMED', accessor: (c: VoucherCampaign) => `${c.stats.claimed} / ${c.stats.generated}` },
          { header: 'REDEEMED', accessor: (c: VoucherCampaign) => String(c.stats.redeemed) },
          {
            header: 'STATUS',
            accessor: (c: VoucherCampaign) => (
              <StatusChip variant="solid" tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status}</StatusChip>
            ),
          },
          {
            header: 'ACTION',
            accessor: (c: VoucherCampaign) => (
              <div className="vouchers-row-actions">
                <Button variant="secondary" size="sm" onClick={() => onView(c)}>View</Button>
                {c.status !== 'ended' && (
                  <Button variant="secondary" size="sm" onClick={() => onToggle(c)}>
                    {c.status === 'active' ? 'Pause' : 'Resume'}
                  </Button>
                )}
              </div>
            ),
            width: '200px',
          },
        ]}
        data={campaigns}
        selectable={false}
        emptyMessage="No campaigns yet. Create one above — bulk codes for print handouts live here."
      />
      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={onPage}
        ariaLabel="Voucher campaigns"
        summary={total > 0 ? `${total} campaign${total === 1 ? '' : 's'}` : undefined}
      />
    </>
  );
}
