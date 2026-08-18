import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bike, Store, UserRound } from 'lucide-react';
import Table from '../../../components/Table';
import SearchField from '../../../components/SearchField';
import { Banner, PartyChip } from '../ui';
import { searchParties, type PartySearchResult } from '../../../services/accounting.service';
import { apiErrorMessage } from '../../../utils/serverValidation';
import '../Accounting.css';

// Search a name, then open everything that moved because of that person.
//
// The other Finance screens are organised by account, which is how books are
// kept but not how questions are asked. Nobody wonders "what is on account
// 5100" — they wonder what a rider has cost this month, or where things stand
// with a vendor. That question spans accounts, so the answer gets a page of its
// own; this tab only picks who it is about.

const PARTY_ICON = { rider: Bike, vendor: Store, user: UserRound } as const;
const PARTY_LABEL = { rider: 'Rider', vendor: 'Vendor', user: 'Staff' } as const;

const PartySearchTab: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [results, setResults] = useState<PartySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced so typing a name is one request, not one per keystroke.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      setError(null);
      searchParties(term)
        .then(setResults)
        .catch((err) => {
          setResults([]);
          setError(apiErrorMessage(err, 'Could not search right now'));
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // The typed name rides along so the person page can send you back to the same
  // list you picked from.
  const open = (result: PartySearchResult) => {
    const q = query.trim();
    navigate(
      `/accounting/people/${result.partyType}/${result.partyId}${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    );
  };

  // Copied off the existing params, not built fresh — the shell keeps the
  // active tab in `?tab=` and a fresh URLSearchParams would drop it on every
  // keystroke.
  const onQueryChange = (value: string) => {
    setQuery(value);
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  return (
    <>
      <div className="acc-toolbar">
        <label className="acc-filter-wide">
          <span>SEARCH</span>
          <SearchField
            value={query}
            onChange={onQueryChange}
            placeholder="Type a name or phone number…"
            autoFocus
          />
        </label>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      {query.trim().length >= 2 ? (
        <div className="acc-panel">
          <div className="acc-panel-head">
            <div>
              <h2>{searching ? 'Searching…' : `${results.length} match${results.length === 1 ? '' : 'es'}`}</h2>
              <p>Riders, vendors and staff</p>
            </div>
          </div>
          <Table
            selectable={false}
            loading={searching && results.length === 0}
            loadingMessage="Searching…"
            data={results.map((result) => ({ ...result, id: `${result.partyType}-${result.partyId}` }))}
            onRowClick={open}
            columns={[
              {
                header: '',
                width: '52px',
                accessor: (result) => {
                  const Icon = PARTY_ICON[result.partyType];
                  return <Icon size={16} className="acc-muted" />;
                },
              },
              {
                header: 'Name',
                accessor: (result) => (
                  <>
                    <span className="acc-link">{result.name}</span>
                    {result.subtitle && <span className="acc-sub">{result.subtitle}</span>}
                  </>
                ),
              },
              {
                header: 'Type',
                width: '120px',
                accessor: (result) => <PartyChip>{PARTY_LABEL[result.partyType]}</PartyChip>,
              },
            ]}
            emptyMessage={`Nobody matches “${query.trim()}”.`}
          />
        </div>
      ) : (
        <Banner tone="info">
          Search for anyone money has moved for. A rider shows the COD they are holding alongside their
          fuel, salary and maintenance; a vendor shows COD collected, charges earned and payouts made.
        </Banner>
      )}
    </>
  );
};

export default PartySearchTab;
