import React from 'react';

interface Props {
  title: string;
  /** Pre-formatted, so the caller decides which lines carry a Dr/Cr suffix. */
  lines: Array<{ label: string; value: string }>;
}

/** The figures a ledger is read for, restated under it as a short list. */
const LedgerSummary: React.FC<Props> = ({ title, lines }) => (
  <section className="tly-summary">
    <h2>{title}</h2>
    <dl>
      {lines.map((line) => (
        <div key={line.label}>
          <dt>{line.label}</dt>
          <dd>{line.value}</dd>
        </div>
      ))}
    </dl>
  </section>
);

export default LedgerSummary;
