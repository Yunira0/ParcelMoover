import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Ticket, Banknote, Bike, ArrowDownToLine } from 'lucide-react';
import Button from '../Button';
import './VendorQuickActions.css';

// Raise Ticket / Request COD / Pickup Request all ride on the ticket system:
// "/tickets?new=<category>" opens the create-ticket modal pre-set to that
// category (COD settlement and pickup have dedicated forms in the modal).
const VendorQuickActions: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="vendor-quick-actions">
      <Button variant="outline" onClick={() => navigate('/orders/create')}>
        Create Order
        <Plus size={16} />
      </Button>
      <Button variant="outline" onClick={() => navigate('/tickets?new=general')}>
        Raise Ticket
        <Ticket size={16} />
      </Button>
      <Button variant="outline" onClick={() => navigate('/tickets?new=cod_settlement')}>
        Request COD
        <Banknote size={16} />
      </Button>
      <Button variant="outline" onClick={() => navigate('/tickets?new=pickup')}>
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
