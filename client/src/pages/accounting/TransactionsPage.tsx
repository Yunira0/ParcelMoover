import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import TransactionsTab from './tabs/TransactionsTab';
import PaymentVoucherModal from './PaymentVoucherModal';
import { screenConfig } from './screens';
import type { TransactionDirection, TransactionScope } from '../../services/accounting.service';
import { hasAdminPermission } from '../../utils/auth';
import './Accounting.css';

// The cash and bank registers. Rider COD and Vendor COD are the same body under
// a different shell (CodPage), because those two also carry the settlement
// statements that used to live on the COD Management screen.

interface TransactionsPageProps {
  scope: TransactionScope;
  direction?: TransactionDirection;
}

const TransactionsPage: React.FC<TransactionsPageProps> = ({ scope, direction = 'all' }) => {
  const config = screenConfig(scope, direction);
  const [voucherOpen, setVoucherOpen] = useState(false);
  // Remounting the register is how it picks up the entry that was just posted;
  // it owns its own paging and filter state, which a refetch would have to
  // reach into.
  const [postedCount, setPostedCount] = useState(0);

  // Paying money out is the one write these registers carry, and it belongs on
  // the screen the payment will show up on.
  const canPay =
    (scope === 'cash' || scope === 'bank') &&
    direction === 'out' &&
    hasAdminPermission('ACCOUNTING_ACCESS');

  return (
    <div className="acc-page">
      <PageHeader
        title={config.title}
        subtitle={config.subtitle}
        actionLabel={canPay ? 'New payment' : undefined}
        actionIcon={<Plus size={16} />}
        onAction={() => setVoucherOpen(true)}
      />

      <TransactionsTab key={postedCount} scope={scope} direction={direction} />

      {voucherOpen && canPay && (
        <PaymentVoucherModal
          scope={scope === 'bank' ? 'bank' : 'cash'}
          onClose={() => setVoucherOpen(false)}
          onSaved={() => {
            setVoucherOpen(false);
            setPostedCount((count) => count + 1);
          }}
        />
      )}
    </div>
  );
};

export default TransactionsPage;
