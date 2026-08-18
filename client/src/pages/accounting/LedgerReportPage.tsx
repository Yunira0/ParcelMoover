import React from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import PartyBalancesTab from './tabs/PartyBalancesTab';
import LedgerTab from './tabs/LedgerTab';
import './Accounting.css';

// The three ledgers, one page each.
//
// Vendor and rider are the two control accounts broken down per party — which
// is what a subledger is — and Account is any single account in the chart with
// a running balance. Same question, three groupings.

type LedgerView = 'vendor' | 'rider' | 'account';

const HEADINGS: Record<LedgerView, { title: string; subtitle: string }> = {
  vendor: { title: 'Vendor Ledger', subtitle: 'Where the office stands with each vendor' },
  rider: { title: 'Rider Ledger', subtitle: 'Cash each rider is holding' },
  account: { title: 'Account Ledger', subtitle: 'Every movement on one account, with a running balance' },
};

const LedgerReportPage: React.FC<{ view: LedgerView }> = ({ view }) => (
  <div className="acc-page">
    <PageHeader title={HEADINGS[view].title} subtitle={HEADINGS[view].subtitle}>
      {/* Staff have no control account, so they appear on neither list — but
          money is still spent on them, and this is the only way to reach it. */}
      {view !== 'account' && (
        <Link className="acc-link" to="/accounting/people/search">
          Search anyone
        </Link>
      )}
    </PageHeader>

    {view === 'account' ? <LedgerTab /> : <PartyBalancesTab partyType={view} />}
  </div>
);

export default LedgerReportPage;
