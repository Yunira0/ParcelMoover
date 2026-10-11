import React from 'react';
import FormField from '../../components/FormField';
import type { CarrierCharges } from './carrierCharges';

/** The two ways to enter a 3PL's charge: per order, or one total for the statement. */
export const CarrierChargeFields: React.FC<{ charges: CarrierCharges; carrierLabel: string; fieldClassName?: string }> = ({
  charges,
  carrierLabel,
  fieldClassName,
}) => (
  <>
    <div className={fieldClassName}>
      <FormField
        label="Charge per Order"
        type="decimal"
        value={charges.perOrder}
        onChange={charges.setPerOrder}
        placeholder="e.g. 150"
        disabled={charges.totalMode}
        hint={`What ${carrierLabel} keeps on each order. Change a row below if it differs.`}
      />
    </div>
    <div className={fieldClassName}>
      <FormField
        label="Total Charge"
        type="decimal"
        value={charges.total}
        onChange={charges.setTotal}
        placeholder="e.g. 4500"
        hint="Or the whole statement's charge: split evenly across the selected orders, the last one taking any remainder."
      />
    </div>
  </>
);

/** A row's charge input, read-only while a total is being split. */
export const CarrierChargeInput: React.FC<{
  charges: CarrierCharges;
  id: string;
  share: number | undefined;
  label: string;
}> = ({ charges, id, share, label }) => (
  <FormField
    label={label}
    hideLabel
    type="decimal"
    value={charges.rowValue(id, share)}
    onChange={(value) => charges.setRow(id, value)}
    placeholder="0"
    disabled={charges.totalMode}
  />
);
