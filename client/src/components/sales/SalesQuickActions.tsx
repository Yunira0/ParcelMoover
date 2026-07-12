import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Store, Ticket, ArrowDownToLine } from 'lucide-react';
import Button from '../Button';
import './SalesQuickActions.css';

const SalesQuickActions: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="sales-quick-actions">
      <Button variant="outline" onClick={() => navigate('/vendors/new')}>
        Add New Vendor
        <Plus size={16} />
      </Button>
      <Button variant="outline" onClick={() => navigate('/vendors')}>
        My Vendors
        <Store size={16} />
      </Button>
      <Button variant="outline" onClick={() => navigate('/orders/bulk-create')}>
        Bulk Import
        <ArrowDownToLine size={16} />
      </Button>
      <Button variant="outline" onClick={() => navigate('/tickets')}>
        Tickets
        <Ticket size={16} />
      </Button>
    </div>
  );
};

export default SalesQuickActions;
