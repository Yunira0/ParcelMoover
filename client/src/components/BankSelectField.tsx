import React, { useEffect, useState } from 'react';
import FormField from './FormField';
import { getBanks } from '../queries/lookups';
import type { Bank } from '../services/banks.service';

interface BankSelectFieldProps {
  /** The selected bank's name, as stored. */
  value: string;
  onChange: (bankName: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Inline validation error for the bank name. */
  error?: string;
  label?: string;
}

/**
 * Bank name picker with its bank code beside it. The banks come from the list
 * the super admin maintains under System Management; the code is read-only and follows the
 * selection, so it can never disagree with the name.
 *
 * The saved value always stays selectable, even if its bank has since been
 * disabled or was typed freely before the list existed, so opening a record
 * never blanks the field.
 */
const BankSelectField: React.FC<BankSelectFieldProps> = ({
  value,
  onChange,
  required = false,
  disabled = false,
  error,
  label = 'Name of Bank',
}) => {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    getBanks().then(setBanks).catch(() => setLoadFailed(true));
  }, []);

  const options = banks
    .filter((bank) => bank.isActive || bank.name === value)
    .map((bank) => ({ id: bank.name, label: bank.name }));
  if (value && !banks.some((bank) => bank.name === value)) options.unshift({ id: value, label: value });

  return (
    <>
      <FormField
        label={label}
        type="searchable-select"
        required={required}
        disabled={disabled}
        value={value}
        onChange={onChange}
        placeholder="Select bank"
        searchPlaceholder="Search bank…"
        emptyMessage="No matching bank."
        searchableOptions={options}
        error={error || (loadFailed ? "Couldn't load banks - refresh the page to try again." : undefined)}
      />
      <FormField
        label="Bank Code"
        value={banks.find((bank) => bank.name === value)?.code ?? ''}
        onChange={() => {}}
        placeholder="Filled in when a bank is selected"
        disabled
      />
    </>
  );
};

export default BankSelectField;
