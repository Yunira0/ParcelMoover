import type { JournalLine } from '../../services/accounting.service';

const COD_TO_PAY_TO_VENDOR = '2005';

/**
 * An entry's lines as a voucher shows them.
 *
 * A rider's or a 3PL's COD hand-over credits 2005 once per vendor whose money
 * it is. The books need that split so each vendor's share nets against their
 * own statement; someone reading the voucher doesn't, so the lines on 2005 that
 * share a side are shown as one - tagged to the rider when the entry is a
 * rider's, untagged otherwise. A vendor statement has a single 2005 line and is
 * left alone.
 */
export function compactLines(lines: JournalLine[]): JournalLine[] {
  const held = (line: JournalLine, side: 'debit' | 'credit') =>
    line.accountCode === COD_TO_PAY_TO_VENDOR && line[side] > 0;
  const rider = lines.find((line) => line.partyType === 'rider');

  let result = lines;
  for (const side of ['debit', 'credit'] as const) {
    const group = result.filter((line) => held(line, side));
    if (group.length < 2) continue;

    const merged: JournalLine = {
      ...group[0]!,
      [side]: Math.round(group.reduce((sum, line) => sum + line[side], 0) * 100) / 100,
      partyType: rider?.partyType ?? null,
      partyId: rider?.partyId ?? null,
      partyName: rider?.partyName ?? null,
    };
    result = result.flatMap((line) => (line === group[0] ? [merged] : held(line, side) ? [] : [line]));
  }
  return result;
}

const COD_WITH_3PL = '1020';

/**
 * The Day Book's shorter view: a rider's or a 3PL's hand-over without its 2005
 * line, since the scan only needs where the cash went. The voucher still shows
 * the whole, balanced entry. Vendor statements keep theirs - there 2005 is the
 * vendor being settled.
 */
export function dayBookLines(lines: JournalLine[]): JournalLine[] {
  const handOver = lines.some((line) => line.partyType === 'rider' || line.accountCode === COD_WITH_3PL);
  const compact = compactLines(lines);
  return handOver ? compact.filter((line) => line.accountCode !== COD_TO_PAY_TO_VENDOR) : compact;
}
