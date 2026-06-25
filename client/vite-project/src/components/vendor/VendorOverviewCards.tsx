import React from 'react';
import { Clock, Truck, ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import StatCard from '../StatCard';
import './VendorOverviewCards.css';

interface VendorOverviewCardsProps {
  orders: number;
  delivered: number;
  processing: number;
  returns: number;
  loading?: boolean;
}

const VendorOverviewCards: React.FC<VendorOverviewCardsProps> = ({
  orders,
  delivered,
  processing,
  returns,
  loading = false,
}) => {
  const display = (value: number) => (loading ? '...' : value.toLocaleString());

  const cards = [
    { icon: Clock, label: 'Orders', value: display(orders) },
    { icon: Truck, label: 'Delivered', value: display(delivered) },
    { icon: ArrowLeftRight, label: 'Processing', value: display(processing) },
    { icon: CheckCircle2, label: 'Return', value: display(returns) },
  ];

  return (
    <div className="vendor-overview-cards">
      <h2 className="section-title">Overview</h2>
      <div className="vendor-overview-cards-row">
        {cards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>
    </div>
  );
};

export default VendorOverviewCards;
