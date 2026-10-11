import React from 'react';
import { splitVat, sumVatSplits } from '../utils/vat';

/**
 * A settlement table's delivery-charge column, split into the charge before VAT
 * and the VAT inside it when the statement carries a rate. Without one it is
 * the single column it always was, so older statements read as they did.
 * Header and cells take the same `vatRate`, so the two can't disagree.
 */
export const DeliveryChargeHeads: React.FC<{ vatRate?: number | null; className?: string; label?: string }> = ({
  vatRate,
  className,
  label = 'Delivery Charge',
}) =>
  vatRate ? (
    <>
      <th className={className}>{label}</th>
      <th className={className}>VAT {vatRate}%</th>
    </>
  ) : (
    <th className={className}>{label}</th>
  );

export const DeliveryChargeCells: React.FC<{
  charge: number;
  vatRate?: number | null;
  className?: string;
  format: (value: number) => string;
}> = ({ charge, vatRate, className, format }) => {
  if (!vatRate) return <td className={className}>{format(charge)}</td>;
  const { net, vat } = splitVat(charge, vatRate);
  return (
    <>
      <td className={className}>{format(net)}</td>
      <td className={className}>{format(vat)}</td>
    </>
  );
};

/** The totals block's delivery-charge line(s), as `<div><span>label</span><span>value</span></div>` rows. */
export const DeliveryChargeTotalRows: React.FC<{
  charges: number[];
  vatRate?: number | null;
  format: (value: number) => string;
  label?: string;
}> = ({ charges, vatRate, format, label = 'Delivery Charges' }) => {
  if (!vatRate) {
    return (
      <div>
        <span>{label}</span>
        <span>{format(charges.reduce((sum, charge) => sum + charge, 0))}</span>
      </div>
    );
  }
  const { net, vat } = sumVatSplits(charges, vatRate);
  return (
    <>
      <div>
        <span>{label} (excl. VAT)</span>
        <span>{format(net)}</span>
      </div>
      <div>
        <span>VAT {vatRate}%</span>
        <span>{format(vat)}</span>
      </div>
    </>
  );
};
