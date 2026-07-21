import React from 'react';
import { ArrowRight, Banknote, Truck, Package } from 'lucide-react';

interface OrderInfoCardsProps {
  senderName: string;
  senderPhone: string;
  senderAddress?: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress?: string;
  origin: string;
  destination: string;
  codAmount: number;
  deliveryCharge: number;
  pieces: number;
  weightKg?: number;
}

const OrderInfoCards: React.FC<OrderInfoCardsProps> = ({
  senderName,
  senderPhone,
  senderAddress,
  receiverName,
  receiverPhone,
  receiverAddress,
  origin,
  destination,
  codAmount,
  deliveryCharge,
  pieces,
  weightKg,
}) => {
  return (
    <div className="od-details">
      {/* Sender + Receiver side by side */}
      <div className="od-details-row">
        <div className="od-details-half">
          <div className="od-details-label">
            <span className="od-details-dot od-details-dot-sender" />
            Sender
          </div>
          <p className="od-details-name">{senderName}</p>
          <p className="od-details-phone">{senderPhone}</p>
          {senderAddress && <p className="od-details-address">{senderAddress}</p>}
        </div>
        <div className="od-details-divider-v" />
        <div className="od-details-half">
          <div className="od-details-label">
            <span className="od-details-dot od-details-dot-receiver" />
            Receiver
          </div>
          <p className="od-details-name">{receiverName}</p>
          <p className="od-details-phone">{receiverPhone}</p>
          {receiverAddress && <p className="od-details-address">{receiverAddress}</p>}
        </div>
      </div>

      {/* Route */}
      <div className="od-details-divider-h" />
      <div className="od-details-route">
        <div className="od-route-end">
          <span className="od-route-dot-sm od-route-dot-origin" />
          <div>
            <span className="od-route-sub">From</span>
            <span className="od-route-city">{origin}</span>
          </div>
        </div>
        <div className="od-route-arrow">
          <span className="od-route-arrow-line" />
          <ArrowRight size={14} className="od-route-arrow-icon" />
          <span className="od-route-arrow-line" />
        </div>
        <div className="od-route-end">
          <span className="od-route-dot-sm od-route-dot-dest" />
          <div>
            <span className="od-route-sub">To</span>
            <span className="od-route-city">{destination}</span>
          </div>
        </div>
      </div>

      {/* Finance row */}
      <div className="od-details-divider-h" />
      <div className="od-details-finance">
        <div className="od-finance-item">
          <Banknote size={14} />
          <span className="od-finance-label">COD</span>
          <span className="od-finance-value">NPR {codAmount.toLocaleString()}</span>
        </div>
        <div className="od-finance-item">
          <Truck size={14} />
          <span className="od-finance-label">Delivery</span>
          <span className="od-finance-value">NPR {deliveryCharge.toLocaleString()}</span>
        </div>
        <div className="od-finance-item">
          <Package size={14} />
          <span className="od-finance-label">Pieces</span>
          <span className="od-finance-value">{pieces}</span>
        </div>
        {weightKg != null && (
          <div className="od-finance-item">
            <Package size={14} />
            <span className="od-finance-label">Weight</span>
            <span className="od-finance-value">{weightKg} kg</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderInfoCards;
