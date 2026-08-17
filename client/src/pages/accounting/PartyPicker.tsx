import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import { PartyChip } from './ui';
import { searchParties, type PartySearchResult } from '../../services/accounting.service';
import './Accounting.css';

// Names the person or company a line belongs to.
//
// Searches rather than lists: there is no bound on how many vendors or riders
// exist, and a select of every one of them is not a thing anyone can use.
//
// `types` narrows the search to the kinds of party the line can legally carry —
// a Cash-with-Rider line only takes a rider, while a payment can be made to a
// rider, a vendor or a member of staff.

export type PartyKind = 'rider' | 'vendor' | 'user';

export interface PickedParty {
  partyType: PartyKind;
  partyId: string;
  partyName: string;
}

/** What a party kind is called on screen. `user` is an admin or staff account. */
const KIND_LABEL: Record<PartyKind, string> = {
  rider: 'rider',
  vendor: 'vendor',
  user: 'admin',
};

const describe = (types: PartyKind[]) => {
  const names = types.map((type) => `${KIND_LABEL[type]}s`);
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
}

const PartyPicker: React.FC<PartyPickerProps> = ({ types, value, onChange, prompt }) => {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PartySearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // types is an inline array at every call site, so a new identity on each
  // render — the effect keys off its contents rather than the array itself.
  const kinds = useMemo(() => types.join(','), [types]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const needle = term.trim();
    const allowed = kinds.split(',');
    // Clearing happens on the same debounce as searching, so the list does not
    // flicker empty between keystrokes.
    timer.current = setTimeout(() => {
      if (needle.length < 2) {
        setResults([]);
        return;
      }
      searchParties(needle)
        .then((rows) => setResults(rows.filter((row) => allowed.includes(row.partyType))))
        .catch(() => setResults([]));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [term, kinds]);

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
      <div
        className="acc-party-search"
        // Blur is deferred so a click on a result lands before the list goes.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => setOpen(true)}
      >
        <FormField
          label=""
          value={term}
          onChange={(next) => {
            setTerm(next);
            setOpen(true);
          }}
          placeholder={`Search ${describe(types)} by name or phone`}
        />
        {open && results.length > 0 && (
          <ul className="acc-party-results">
            {results.map((result) => (
              <li key={`${result.partyType}:${result.partyId}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange({
                      partyType: result.partyType as PartyKind,
                      partyId: result.partyId,
                      partyName: result.name,
                    });
                    setTerm('');
                    setOpen(false);
                  }}
                >
                  <PartyChip>{KIND_LABEL[result.partyType as PartyKind]}</PartyChip>
                  <strong>{result.name}</strong>
                  {result.subtitle && <span className="acc-muted"> · {result.subtitle}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default PartyPicker;
