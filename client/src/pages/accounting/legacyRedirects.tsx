import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';

// The Finance section has been reorganised twice: eight screens became four
// tab shells, and the tab shells then became one leaf per view under three
// dropdown groups. Every path either era produced still resolves here, so
// bookmarks and the links already sent around in chat keep landing on the
// right thing.
//
// <Navigate to="/x"/> drops the query string, so this wrapper carries it across
// and lets each caller rename the params that moved (?type= became ?tab=, and
// ?tab= has now become part of the path).

const Redirect: React.FC<{ to: string; rewrite?: (params: URLSearchParams) => void }> = ({ to, rewrite }) => {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  rewrite?.(params);
  const query = params.toString();
  return <Navigate to={{ pathname: to, search: query ? `?${query}` : '' }} replace />;
};

/**
 * Sends a retired tab shell to whichever leaf its `?tab=` used to select.
 *
 * The tab is consumed rather than passed on — it is the path now, and leaving
 * it behind would put `?tab=journal` on a URL where it means nothing.
 */
const TabRedirect: React.FC<{ routes: Record<string, string>; fallback: string }> = ({ routes, fallback }) => {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  params.delete('tab');
  const query = params.toString();
  return (
    <Navigate
      to={{ pathname: (tab && routes[tab]) || fallback, search: query ? `?${query}` : '' }}
      replace
    />
  );
};

// ── The tab shells ──────────────────────────────────────────────────────────

/** /accounting/books — Journal, Ledger and Periods are now three destinations. */
export const BooksRedirect: React.FC = () => (
  <TabRedirect
    routes={{
      journal: '/accounting/transactions/journal',
      ledger: '/accounting/ledgers/account',
      periods: '/accounting',
    }}
    fallback="/accounting/transactions/journal"
  />
);

/** /accounting/people — Vendors, Riders and Search likewise. */
export const PeopleRedirect: React.FC = () => (
  <TabRedirect
    routes={{
      vendor: '/accounting/ledgers/vendor',
      rider: '/accounting/ledgers/rider',
      search: '/accounting/people/search',
    }}
    fallback="/accounting/ledgers/vendor"
  />
);

/**
 * /finance — COD Management, which was the rider and vendor settlement lists
 * behind a toggle. Each half is now its own Finance entry, so the
 * toggle's default (rider) is where an old link lands.
 */
export const CodManagementRedirect: React.FC = () => (
  <Redirect to="/accounting/transactions/rider-cod" />
);

// ── The eight original screens ──────────────────────────────────────────────

/**
 * /accounting/reports — Profit & Loss, Balance Sheet and Trial Balance have been
 * removed from the UI, so an old link lands on the Overview rather than nowhere.
 */
export const ReportsRedirect: React.FC = () => <Redirect to="/accounting" />;

export const JournalRedirect: React.FC = () => <Redirect to="/accounting/transactions/journal" />;

export const LedgerRedirect: React.FC = () => <Redirect to="/accounting/ledgers/account" />;

/** /accounting/periods — likewise: the period-closing screen is gone. */
export const PeriodsRedirect: React.FC = () => <Redirect to="/accounting" />;

export const PartiesRedirect: React.FC = () => {
  const { search } = useLocation();
  const type = new URLSearchParams(search).get('type');
  return <Redirect to={type === 'rider' ? '/accounting/ledgers/rider' : '/accounting/ledgers/vendor'} />;
};

export const PartyLedgerRedirect: React.FC = () => {
  const { partyType = 'vendor', id = '' } = useParams<{ partyType: string; id: string }>();
  return <Redirect to={`/finance/ledger/${partyType === 'rider' ? 'rider' : 'vendor'}/${id}`} />;
};

export const SearchRedirect: React.FC = () => <Redirect to="/accounting/people/search" />;

