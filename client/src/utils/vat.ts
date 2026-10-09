/**
 * VAT % already included in a delivery charge, for statements raised now.
 * Mirrors DELIVERY_CHARGE_VAT_RATE on the server, which stamps it on each new
 * vendor statement; an existing statement carries its own rate (or none).
 */
export const DELIVERY_CHARGE_VAT_RATE = 13;

export interface VatSplit {
  /** The amount before VAT. */
  net: number;
  vat: number;
}

const paisa = (value: number) => Math.round(value * 100) / 100;

/** Splits a VAT-inclusive amount into its pre-VAT part and the VAT inside it. The two always add back to `gross`. */
export function splitVat(gross: number, rate: number): VatSplit {
  const vat = paisa((gross * rate) / (100 + rate));
  return { net: paisa(gross - vat), vat };
}

/** Row splits summed rather than the total split once, so a totals line ties out with the rows above it. */
export function sumVatSplits(grosses: number[], rate: number): VatSplit {
  return grosses.reduce<VatSplit>(
    (total, gross) => {
      const { net, vat } = splitVat(gross, rate);
      return { net: paisa(total.net + net), vat: paisa(total.vat + vat) };
    },
    { net: 0, vat: 0 },
  );
}

/** A split as spreadsheet columns, in the order the tables show them: charge before VAT, then VAT. */
export const vatColumns = ({ net, vat }: VatSplit): [number, number] => [net, vat];
