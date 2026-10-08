import React, { useEffect, useState } from 'react';
import { Building2, ClipboardList, Landmark, Store } from 'lucide-react';
import StatCard from '../../components/StatCard';
import { listVendorPayments } from '../../services/billing.service';
import { listBranchPayments } from '../../services/branchBilling.service';
import { getBranchSettlements } from '../../services/branchTracking.service';
import { getCodSettlementRequests } from '../../services/codSettlementRequests.service';
import { money } from './format';
import './Accounting.css';

// The accountant's to-do list: every queue where money is waiting on the
// office, as a count that links straight to it. Each count is fetched on its
// own so one failing endpoint leaves the others readable.

interface Counts {
  vendorPayments: number | null;
  branchDeposits: number | null;
  codRequests: number | null;
  branchStatements: { count: number; outstanding: number } | null;
}

const settledValue = <T,>(result: PromiseSettledResult<T>): T | null =>
  result.status === 'fulfilled' ? result.value : null;

const AccountantQueue: React.FC = () => {
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      listVendorPayments({ status: 'pending', pageSize: 1 }).then((r) => r.meta.total),
      listBranchPayments({ status: 'pending', pageSize: 1 }).then((r) => r.meta.total),
      Promise.all([
        getCodSettlementRequests({ status: 'open', pageSize: 1 }),
        getCodSettlementRequests({ status: 'in_progress', pageSize: 1 }),
      ]).then(([open, inProgress]) => open.meta.total + inProgress.meta.total),
      getBranchSettlements({ page: 1, pageSize: 1 }).then((r) => ({
        count: r.summary.pendingStatements,
        outstanding: r.summary.outstanding,
      })),
    ]).then(([vendorPayments, branchDeposits, codRequests, branchStatements]) => {
      if (!active) return;
      setCounts({
        vendorPayments: settledValue(vendorPayments),
        branchDeposits: settledValue(branchDeposits),
        codRequests: settledValue(codRequests),
        branchStatements: settledValue(branchStatements),
      });
    });
    return () => { active = false; };
  }, []);

  const show = (value: number | null | undefined) =>
    counts === null ? '…' : value === null || value === undefined ? '—' : value;
  const tone = (value: number | null | undefined) => (value ? 'default' : 'muted');

  return (
    <div className="acc-panel">
      <div className="acc-panel-head">
        <div>
          <h2>Needs attention</h2>
          <p>Money waiting on the office to verify or settle</p>
        </div>
      </div>
      <div className="acc-panel-body">
        <div className="acc-cards">
          <StatCard
            icon={Store}
            label="Vendor payments to verify"
            value={show(counts?.vendorPayments)}
            tone={tone(counts?.vendorPayments)}
            hint="Invoice payments with a screenshot"
            to="/billing"
          />
          <StatCard
            icon={Building2}
            label="Branch deposits to verify"
            value={show(counts?.branchDeposits)}
            tone={tone(counts?.branchDeposits)}
            hint="Receipts branches have sent in"
            to="/branches/billing"
          />
          <StatCard
            icon={ClipboardList}
            label="COD settlement requests"
            value={show(counts?.codRequests)}
            tone={tone(counts?.codRequests)}
            hint="Open or in progress"
            to="/cod-settlement-requests"
          />
          <StatCard
            icon={Landmark}
            label="Unpaid branch statements"
            value={show(counts?.branchStatements?.count)}
            tone={tone(counts?.branchStatements?.count)}
            hint={counts?.branchStatements ? `${money(counts.branchStatements.outstanding)} outstanding` : 'Pending or part-paid'}
            to="/branches/settlement"
          />
        </div>
      </div>
    </div>
  );
};

export default AccountantQueue;
