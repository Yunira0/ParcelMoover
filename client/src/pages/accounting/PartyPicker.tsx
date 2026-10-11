import React, { useCallback, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import Button from '../../components/Button';
import SearchableSelectAsync from '../../components/SearchableSelectAsync';
import { PartyChip } from './ui';
import { searchPartiesPage, type PartySearchResult } from '../../services/accounting.service';
import './Accounting.css';

// Names the person or company a line belongs to.
//
// Pages the eligible parties on open and searches on the server. The shared
// async select handles debounce, keyboard navigation and infinite scrolling.
//
// `types` narrows the search to the kinds of party the line can legally carry —
// a Cash-with-Rider line only takes a rider, while a payment can be made to a
// rider, a vendor or another user.

export type PartyKind = 'rider' | 'vendor' | 'user';

export interface PickedParty {
  partyType: PartyKind;
  partyId: string;
  partyName: string;
}

/** What a party kind is called on screen. `user` covers admin and staff logins. */
const KIND_LABEL: Record<PartyKind, string> = {
  rider: 'rider',
  vendor: 'vendor',
  user: 'admin / staff',
};

const KIND_PLURAL: Record<PartyKind, string> = {
  rider: 'riders',
  vendor: 'vendors',
  user: 'admin / staff',
};

const describe = (types: PartyKind[]) => {
  const names = types.map((type) => KIND_PLURAL[type]);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
};

interface PartyPickerProps {
  /** The kinds of party this line accepts. */
  types: PartyKind[];
  value: PickedParty | null;
  onChange: (party: PickedParty | null) => void;
  /** Overrides the prompt shown when nothing is picked; "" drops it entirely. */
  prompt?: string;
  /** Accessible name when the picker has a separate visible label. */
  inputLabel?: string;
}

const PartyPicker: React.FC<PartyPickerProps> = ({ types, value, onChange, prompt, inputLabel }) => {
  const seen = useRef(new Map<string, PartySearchResult>());

  // types is an inline array at every call site, so a new identity on each
  // render — the effect keys off its contents rather than the array itself.
  const kinds = useMemo(() => types.join(','), [types]);
  const findParties = useCallback(async (query: string, offset: number) => {
    const page = await searchPartiesPage(query, kinds.split(',') as PartyKind[], offset);
    return {
      hasMore: page.hasMore,
      results: page.results.map((result) => {
        const id = `${result.partyType}:${result.partyId}`;
        seen.current.set(id, result);
        return {
          id,
          label: result.name,
          description: `${KIND_LABEL[result.partyType]}${result.subtitle ? ` · ${result.subtitle}` : ''}`,
        };
      }),
    };
  }, [kinds]);

  const selectParty = (id: string) => {
    const result = seen.current.get(id);
    if (!result) return;
    onChange({ partyType: result.partyType, partyId: result.partyId, partyName: result.name });
  };

  if (value) {
    return (
      <div className="acc-entry-party">
        <PartyChip>{KIND_LABEL[value.partyType]}</PartyChip>
        <strong>{value.partyName}</strong>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(null)}
          aria-label="Clear the party on this line"
        >
          <X size={14} />
        </Button>
      </div>
    );
  }

  return (
    <div className="acc-entry-party">
      {(prompt ?? `Which ${describe(types)}?`) && (
        <span className="acc-muted">{prompt ?? `Which ${describe(types)}?`}</span>
      )}
      <div className="acc-party-search">
        <SearchableSelectAsync
          asyncSearch={findParties}
          value=""
          onChange={selectParty}
          placeholder={`Select ${describe(types)}`}
          searchPlaceholder={`Search ${describe(types)} by name or phone`}
          ariaLabel={inputLabel ?? 'Party'}
          debounceMs={200}
        />
      </div>
    </div>
  );
};

export default PartyPicker;
