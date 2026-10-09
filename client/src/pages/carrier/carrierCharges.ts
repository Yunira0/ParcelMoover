import { useCallback, useState } from 'react';

const paisa = (value: number) => Math.round(value * 100) / 100;

/**
 * A total split evenly across `count` orders, to the paisa. The shares are
 * rounded down and the last order takes what is left, so they always add back
 * to the total exactly.
 */
export function splitTotal(total: number, count: number): number[] {
  if (count <= 0) return [];
  const share = Math.floor((total * 100) / count) / 100;
  return [...new Array(count - 1).fill(share), paisa(total - share * (count - 1))];
}

/**
 * A 3PL statement's charges: a default per order with any row overridden, or a
 * total for the whole statement split across the orders in it. A total, once
 * typed, wins - the rows then show their share.
 */
export function useCarrierCharges(initialRows: Record<string, string> = {}, initialTotal = '') {
  const [perOrder, setPerOrder] = useState('');
  const [total, setTotal] = useState(initialTotal);
  const [rows, setRows] = useState<Record<string, string>>(initialRows);
  const totalMode = total.trim() !== '';

  /** Each selected order's charge, in the order given - which decides who takes the remainder. */
  const chargesFor = useCallback(
    (ids: string[]): Map<string, number> => {
      if (totalMode) {
        const shares = splitTotal(Number(total) || 0, ids.length);
        return new Map(ids.map((id, index) => [id, shares[index]!]));
      }
      return new Map(ids.map((id) => [id, Number(rows[id] ?? perOrder) || 0]));
    },
    [totalMode, total, rows, perOrder],
  );

  const setRow = useCallback((id: string, value: string) => setRows((prev) => ({ ...prev, [id]: value })), []);
  /** What a row's input shows: its share under a total, otherwise its own or the default charge. */
  const rowValue = (id: string, share: number | undefined) =>
    totalMode ? (share === undefined ? '' : String(share)) : rows[id] ?? perOrder;

  const resetRows = useCallback(() => setRows({}), []);

  return { perOrder, setPerOrder, total, setTotal, totalMode, chargesFor, setRow, rowValue, resetRows };
}

export type CarrierCharges = ReturnType<typeof useCarrierCharges>;
