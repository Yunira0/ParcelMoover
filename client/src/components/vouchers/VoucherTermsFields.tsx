import FormField from '../FormField';
import SegmentedTabs from '../SegmentedTabs';

export interface VoucherTermsValues {
  title: string;
  description: string;
  discountType: 'fixed' | 'percent';
  discountAmount: string;
  discountPercent: string;
  maxDiscount: string;
  minimumCharge: string;
  startsAt: string;
  expiresAt: string;
}

interface VoucherTermsFieldsProps {
  values: VoucherTermsValues;
  onChange: (patch: Partial<VoucherTermsValues>) => void;
  disabled?: boolean;
  /** Server-side validation errors, keyed by field name. */
  errors?: Record<string, string>;
}

/** Local AD "YYYY-MM-DD", offset by days from now — the shape FormField's
 *  type="date" (the shared Nepali date picker) reads and writes. */
export function localDate(daysFromNow = 0): string {
  const d = new Date(Date.now() + daysFromNow * 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A voucher is valid for the whole of its last day, so the API's instant is
 *  that day's local end — not midnight, which would expire it a day early. */
export function expiryIso(day: string): string {
  return new Date(`${day}T23:59:59`).toISOString();
}

/** Starting point for a new offer: live now, running a month. */
export const defaultVoucherTerms = (): VoucherTermsValues => ({
  title: '',
  description: '',
  discountType: 'fixed',
  discountAmount: '',
  discountPercent: '',
  maxDiscount: '',
  minimumCharge: '0',
  startsAt: localDate(0),
  expiresAt: localDate(30),
});

/** Total-use ceiling for callers that do not ask for one (the campaign wizard);
 *  the standalone form has its own Total uses field. */
export const OPEN_CLAIM_LIMIT = 100000;

/**
 * The API needs a description and a start time; the voucher shows neither, so
 * the form does not ask. Start now, and write the description from the terms
 * that are on the card — it still reads as a sentence wherever it surfaces.
 */
export function deriveHiddenTerms(values: VoucherTermsValues): {
  description: string;
  startsAt: string;
  claimLimit: number;
} {
  const off = values.discountType === 'percent'
    ? `${values.discountPercent || 0}% off`
    : `Rs. ${values.discountAmount || 0} off`;
  const minimum = Number(values.minimumCharge) > 0
    ? ` on orders over Rs. ${values.minimumCharge}`
    : '';
  return {
    description: `${values.title.trim() || 'Delivery reward'}: ${off} your delivery charge${minimum}.`,
    startsAt: new Date().toISOString(),
    claimLimit: OPEN_CLAIM_LIMIT,
  };
}

/**
 * The shared offer-terms block: identical fields for a standalone publish and
 * a campaign wizard, so the two can never drift apart. Every field here maps to
 * something printed on the voucher — description, start time and the total-use
 * cap are derived in deriveHiddenTerms rather than asked for. Wording is
 * deliberately plain: whoever runs a promotion did not necessarily build it.
 */
export default function VoucherTermsFields({ values, onChange, disabled, errors = {} }: VoucherTermsFieldsProps) {
  const set = (patch: Partial<VoucherTermsValues>) => onChange(patch);
  return (
    <>
      <FormField
        label="Offer name"
        required
        minLength={3}
        gridColumn="1 / -1"
        hint="The headline vendors see, e.g. “Dashain delivery treat”"
        error={errors.title}
        value={values.title}
        onChange={v => set({ title: v })}
        placeholder="Dashain delivery treat"
        disabled={disabled}
      />
      <div className="voucher-field-group" role="group" aria-labelledby="voucher-discount-label">
        <span className="voucher-field-label" id="voucher-discount-label">Discount</span>
        <SegmentedTabs
          options={[{ value: 'fixed', label: 'Rupees off' }, { value: 'percent', label: 'Percent off' }]}
          value={values.discountType}
          onChange={v => set({ discountType: v })}
          ariaLabel="Discount kind"
          fullWidth
          minTabWidth="110px"
        />
      </div>

      {values.discountType === 'fixed'
        ? <FormField
            label="Amount off"
            required
            type="decimal"
            hint="Taken off the delivery charge"
            error={errors.discountAmount}
            value={values.discountAmount}
            onChange={v => set({ discountAmount: v })}
            placeholder="100"
            disabled={disabled}
          />
        : <>
          <FormField
            label="Percent off"
            required
            type="decimal"
            hint="e.g. 10 for 10% off"
            error={errors.discountPercent}
            value={values.discountPercent}
            onChange={v => set({ discountPercent: v })}
            placeholder="10"
            disabled={disabled}
          />
          <FormField
            label="Most it can take off"
            type="decimal"
            hint="Leave blank for no cap"
            error={errors.maxDiscount}
            value={values.maxDiscount}
            onChange={v => set({ maxDiscount: v })}
            placeholder="No cap"
            disabled={disabled}
          />
        </>}

      <FormField
        label="Smallest order it works on"
        type="decimal"
        hint="0 means any order"
        error={errors.minimumCharge}
        value={values.minimumCharge}
        onChange={v => set({ minimumCharge: v })}
        placeholder="0"
        disabled={disabled}
      />
      <FormField
        label="Valid till"
        required
        type="date"
        hint="Printed on the voucher — good for the whole day"
        error={errors.expiresAt}
        value={values.expiresAt}
        onChange={v => set({ expiresAt: v })}
        disabled={disabled}
      />
    </>
  );
}
