import React from 'react';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import TransactionsTab from './tabs/TransactionsTab';
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
  const navigate = useNavigate();
  const config = screenConfig(scope, direction);

  // Posting either side belongs on the screen the entry will show up on. Both
  // land on the same Cash & Bank voucher screen — a Payment there when this is
  // the "out" register, a Receipt when it is the "in" one — so there is one
  // voucher experience instead of a second modal duplicating it.
  const canWrite =
    (scope === 'cash' || scope === 'bank') &&
    (direction === 'out' || direction === 'in') &&
    hasAdminPermission('ACCOUNTING_ACCESS');
  const voucherType = direction === 'out' ? 'payment' : 'receipt';

  return (
    <div className="acc-page">
      <PageHeader
        title={config.title}
        subtitle={config.subtitle}
        actionLabel={canWrite ? (direction === 'out' ? 'New payment' : 'New receipt') : undefined}
        actionIcon={<Plus size={16} />}
        onAction={() => navigate(`/finance/voucher/new?type=${voucherType}`)}
      />

      <TransactionsTab scope={scope} direction={direction} />
    </div>
  );
};

export default TransactionsPage;
