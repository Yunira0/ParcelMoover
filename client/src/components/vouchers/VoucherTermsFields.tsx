import FormField from '../FormField';

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
}

/**
 * The shared offer-terms block: identical fields for a standalone publish and
 * a campaign wizard, so the two can never drift apart.
 */
export default function VoucherTermsFields({ values, onChange, disabled }: VoucherTermsFieldsProps) {
  const set = (patch: Partial<VoucherTermsValues>) => onChange(patch);
  return (
    <>
      <FormField label="Title" required minLength={3} value={values.title} onChange={v => set({ title: v })} placeholder="Rs. 100 off delivery" disabled={disabled} />
      <FormField label="Description" required type="textarea" rows={3} gridColumn="1 / -1" hint="Visible to vendors" minLength={10} value={values.description} onChange={v => set({ description: v })} disabled={disabled} />
      <FormField
        label="Discount type"
        type="select"
        value={values.discountType}
        onChange={v => set({ discountType: v as 'fixed' | 'percent' })}
        options={[{ value: 'fixed', label: 'Fixed Rs. off' }, { value: 'percent', label: 'Percent off' }]}
        disabled={disabled}
      />
      {values.discountType === 'fixed'
        ? <FormField label="Discount (Rs.)" required type="decimal" value={values.discountAmount} onChange={v => set({ discountAmount: v })} placeholder="0.00" disabled={disabled} />
        : <>
          <FormField label="Discount (%)" required type="decimal" value={values.discountPercent} onChange={v => set({ discountPercent: v })} placeholder="10" disabled={disabled} />
          <FormField label="Max discount (Rs.)" type="decimal" hint="Optional cap" value={values.maxDiscount} onChange={v => set({ maxDiscount: v })} placeholder="No cap" disabled={disabled} />
        </>}
      <FormField label="Minimum delivery charge (Rs.)" type="decimal" value={values.minimumCharge} onChange={v => set({ minimumCharge: v })} placeholder="0" disabled={disabled} />
      <FormField label="Starts at" required type="datetime-local" hint="Your local time" value={values.startsAt} onChange={v => set({ startsAt: v })} disabled={disabled} />
      <FormField label="Expires at" required type="datetime-local" hint="Your local time" value={values.expiresAt} onChange={v => set({ expiresAt: v })} disabled={disabled} />
    </>
  );
}
