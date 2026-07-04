import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Ticket, Banknote, Bike, ArrowDownToLine } from 'lucide-react';
import Button from '../Button';
import './VendorQuickActions.css';

// "Create Order" and "Bulk Import" are wired to real endpoints. The rest map
// to features that don't have a vendor-facing API yet, so they're shown
// (matching the design) but disabled rather than faked.
const VendorQuickActions: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="vendor-quick-actions">
      <Button variant="outline" onClick={() => navigate('/orders/create')}>
        Create Order
        <Plus size={16} />
      </Button>
      <Button variant="outline" disabled title="Ticket creation for vendors is coming soon">
        Raise Ticket
        <Ticket size={16} />
      </Button>
      <Button variant="outline" disabled title="COD remittance requests are coming soon">
        Request COD
        <Banknote size={16} />
      </Button>
      <Button variant="outline" disabled title="Pickup requests are coming soon">
        Pickup Request
        <Bike size={16} />
      </Button>
      <Button variant="outline" onClick={() => navigate('/orders/bulk-create')}>
        Bulk Import
        <ArrowDownToLine size={16} />
      </Button>
    </div>
  );
};

export default VendorQuickActions;
