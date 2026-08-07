import type { CodDetailBucket } from '../services/orders.service';

// One entry per line of the COD Settlement dashboard card. The card and its
// drill-down page both read labels from here, so a row can never be titled one
// thing on the dashboard and another on the page it links to.
//
// `carrier: true` marks the buckets nested under the "COD to collect from
// riders" heading. Adding a future 3PL is a three-line change: a slug in
// COD_DETAIL_BUCKETS (client and server), an entry here with carrier: true,
// and a matching FILTER clause in the server's COD queries.
export interface CodBucketMeta {
  /** Row label on the dashboard card. */
  label: string;
  /** Page heading on the drill-down - spelled out, since it loses the card's context. */
  title: string;
  /** What the per-row amount column means for this bucket. */
  amountHeader: string;
  /** One line under the page heading explaining what the figure counts. */
  description: string;
  /** Nested under the "COD to collect from riders" heading on the card. */
  carrier?: boolean;
}

export const COD_BUCKET_META: Record<CodDetailBucket, CodBucketMeta> = {
  total: {
    label: 'Total COD',
    title: 'Total COD',
    amountHeader: 'COLLECTED',
    description: 'Cash collected on every delivered order in scope.',
  },
  settled: {
    label: 'Settled COD',
    title: 'Settled COD',
    amountHeader: 'SETTLED',
    description: 'Collected cash that has already been remitted onward.',
  },
  pending: {
    label: 'Pending',
    title: 'Pending COD',
    amountHeader: 'OUTSTANDING',
    description: 'Collected cash not yet remitted onward.',
  },
  'pm-rider': {
    label: 'PM-Rider',
    title: 'COD to collect from PM-Riders',
    amountHeader: 'OUTSTANDING',
    description: 'Cash our own riders are holding and have not remitted to the office.',
    carrier: true,
  },
  ncm: {
    label: '3PL — NCM',
    title: 'COD to collect from NCM',
    amountHeader: 'OUTSTANDING',
    description:
      'Cash NCM collected on our behalf and has not remitted to the office. Parcels are matched by their NCM handoff record, so only orders actually shipped through the NCM API are counted.',
    carrier: true,
  },
  'delivery-charge': {
    label: 'Delivery charge',
    title: 'Delivery charge',
    amountHeader: 'DELIVERY CHARGE',
    description: "The office's cut on the delivered orders behind the COD figures.",
  },
};

export const codBucketPath = (bucket: CodDetailBucket) => `/cod/${bucket}`;
