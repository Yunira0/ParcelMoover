import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Truck, Banknote, FileDown } from 'lucide-react';
import Button from './Button';
import './QuickActions.css';

// Admin dashboard shortcuts. Mirrors the sales dashboard's quick-action row
// (SalesQuickActions) so both dashboards feel the same, but points at the
// operations routes an admin works from.
const QuickActions: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="quick-actions">
      <Button variant="outline" onClick={() => navigate('/orders/create')}>
        New order
        <Plus size={16} />
      </Button>
      <Button variant="outline" onClick={() => navigate('/pickup')}>
        Assign pickup
        <Truck size={16} />
      </Button>
      <Button variant="outline" onClick={() => navigate('/finance/settlements/new')}>
        Settle COD
        <Banknote size={16} />
      </Button>
      <Button variant="outline" onClick={() => navigate('/reports')}>
        Export reports
        <FileDown size={16} />
      </Button>
    </div>
  );
};

export default QuickActions;
