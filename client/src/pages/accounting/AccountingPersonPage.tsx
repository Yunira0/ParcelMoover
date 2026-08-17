import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Bike, Store, UserRound } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import SegmentedTabs, { type SegmentedTabOption } from '../../components/SegmentedTabs';
import PersonFlowTab from './tabs/PersonFlowTab';
import PersonLedgerTab from './tabs/PersonLedgerTab';
import { PartyChip } from './ui';
import './Accounting.css';

// One person, one page. Money flow spans every account they ever touched;
// Ledger is the single control account with a running balance — the statement
// you could hand them. Staff have no control account, so they get flow only.

type PersonTab = 'flow' | 'ledger';

const PARTY_ICON = { rider: Bike, vendor: Store, user: UserRound } as const;
const PARTY_LABEL: Record<string, string> = { rider: 'Rider', vendor: 'Vendor', user: 'Staff' };

const SUBTITLE: Record<string, string> = {
  rider: 'COD collected, cash remitted, and what the office spends on them',
  vendor: 'COD collected, charges earned and payouts made',
  user: 'Everything paid to and collected from them',
};

const OPTIONS: SegmentedTabOption<PersonTab>[] = [
  { value: 'flow', label: 'Money flow' },
  { value: 'ledger', label: 'Ledger' },
];

const AccountingPersonPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { partyType = '', partyId = '' } = useParams<{ partyType: string; partyId: string }>();

  const supportsLedger = partyType === 'rider' || partyType === 'vendor';
  const [tab, setTab] = useState<PersonTab>(() =>
    searchParams.get('tab') === 'ledger' && supportsLedger ? 'ledger' : 'flow',
  );

  // The title is the person's name, which only the tab bodies know once their
  // fetch lands. Cleared when the route points at somebody else, since the
  // component instance is reused and would otherwise show the last name.
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    setName(null);
  }, [partyType, partyId]);

  const onTitle = useCallback((next: string) => setName(next), []);

  const selectTab = (next: PersonTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
    setTab(next);
  };

  // Back to whichever list this person was picked from. A staff member can only
  // be reached through the search tab, so they always arrive carrying ?q=.
  const backToList = () => {
    const q = searchParams.get('q');
    navigate(
      q
        ? `/accounting/people/search?q=${encodeURIComponent(q)}`
        : `/accounting/ledgers/${partyType === 'rider' ? 'rider' : 'vendor'}`,
    );
  };

  const Icon = PARTY_ICON[partyType as keyof typeof PARTY_ICON] ?? UserRound;
  const label = PARTY_LABEL[partyType] ?? 'Person';

  return (
    <div className="acc-page">
      <PageHeader
        title={name ?? 'Money flow'}
        subtitle={SUBTITLE[partyType] ?? 'Everything paid to and collected from them'}
        onBack={backToList}
      />

      <div className="acc-toolbar">
        <PartyChip>
          <Icon size={13} />
          <span style={{ marginLeft: 4 }}>{label}</span>
        </PartyChip>
        {supportsLedger && (
          <SegmentedTabs
            options={OPTIONS}
            value={tab}
            onChange={selectTab}
            ariaLabel="Person view"
            fullWidth={false}
          />
        )}
      </div>

      {tab === 'ledger' && supportsLedger ? (
        <PersonLedgerTab partyType={partyType} partyId={partyId} onTitle={onTitle} />
      ) : (
        <PersonFlowTab partyType={partyType} partyId={partyId} onTitle={onTitle} />
      )}
    </div>
  );
};

export default AccountingPersonPage;
