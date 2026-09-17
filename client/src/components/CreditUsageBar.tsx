import React from 'react';
import { creditOwed, creditUsagePct } from '../utils/creditUsage';
import { formatCurrency } from '../utils/format';

type UsageTone = 'ok' | 'warned' | 'blocked';

interface CreditUsageBarProps {
  balance: number;
  creditLimit: number;
  state: UsageTone;
  id?: string;
}

// How much of a vendor's credit limit is used — the one glanceable answer on
// every billing surface. Bar color follows the billing state (green / olive /
// red); the label always pairs the tone with text, never color alone.
const CreditUsageBar: React.FC<CreditUsageBarProps> = ({ balance, creditLimit, state, id }) => {
  const owed = creditOwed(balance);
  const pct = creditUsagePct(balance, creditLimit);
  const labelId = id ?? `credit-usage-${Math.round(pct)}`;

  return (
    <div className="credit-usage">
      <div
        className="credit-usage-track"
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`credit-usage-fill credit-usage-fill-${state}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="credit-usage-label" id={labelId}>
        {formatCurrency(owed)} of {formatCurrency(creditLimit)} used · {Math.round(pct)}%
      </p>
    </div>
  );
};

export default CreditUsageBar;
