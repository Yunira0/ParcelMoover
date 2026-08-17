import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import TicketCategoryButton from '../../components/TicketCategoryButton';
import SettlementsTab from './tabs/SettlementsTab';
import './Accounting.css';

// Rider COD and Vendor COD — the settlement statements, one page per party type.
//
// This absorbed the old COD Management screen, which was these same two lists
// behind a rider/vendor toggle; the toggle is now the sidebar entry. What each
// settlement did to the books lives under Ledger Report, where a rider
// settlement shows as the remittance that credits 1010 and a vendor settlement
// as the payout that debits 2000.
//
// Deliberately NOT gated on ACCOUNTING_ACCESS. COD Management was open to every
// admin, and the people who create settlements every day are not the people who
// were granted the books.

const HEADINGS = {
  rider: {
    title: 'Rider COD',
    subtitle: 'COD statements settled with each rider',
  },
  vendor: {
    title: 'Vendor COD',
    subtitle: 'COD statements paid out to each vendor',
  },
} as const;

const CodPage: React.FC<{ payeeType: 'rider' | 'vendor' }> = ({ payeeType }) => {
  const navigate = useNavigate();

  return (
    <div className="acc-page">
      <PageHeader
        title={HEADINGS[payeeType].title}
        subtitle={HEADINGS[payeeType].subtitle}
        actionLabel="Add settlement"
        actionIcon={<Plus size={16} />}
        onAction={() => navigate(`/finance/settlements/new?type=${payeeType}`)}
      >
        <TicketCategoryButton
          category="cod_settlement"
          notificationType="cod_settlement"
          to="/cod-settlement-requests"
          label="Settlement Requests"
        />
      </PageHeader>

      <SettlementsTab payeeType={payeeType} />
    </div>
  );
};

export default CodPage;
