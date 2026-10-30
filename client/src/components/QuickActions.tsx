import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Truck, Banknote, FileDown, Send } from 'lucide-react';
import Button from './Button';
import { canOpenPath, isBranchWorkspaceUser } from '../utils/auth';
import './QuickActions.css';

// Admin dashboard shortcuts. Mirrors the sales dashboard's quick-action row
// (SalesQuickActions) so both dashboards feel the same, but points at the
// operations routes an admin works from. A branch workspace gets the subset
// that lives inside its own scope, and every user only sees the ones they can open.
const ADMIN_ACTIONS = [
  { label: 'New order', to: '/orders/create', icon: Plus },
  { label: 'Assign pickup', to: '/pickup', icon: Truck },
  { label: 'Settle COD', to: '/finance/settlements/new', icon: Banknote },
  { label: 'Export reports', to: '/reports', icon: FileDown },
];

const BRANCH_ACTIONS = [
  { label: 'New order', to: '/orders/create', icon: Plus },
  { label: 'Assign pickup', to: '/pickup', icon: Truck },
  { label: 'Local dispatch', to: '/dispatch', icon: Send },
  { label: 'Branch COD', to: '/branches/settlement', icon: Banknote },
];

const QuickActions: React.FC = () => {
  const navigate = useNavigate();
  const actions = (isBranchWorkspaceUser() ? BRANCH_ACTIONS : ADMIN_ACTIONS).filter((action) => canOpenPath(action.to));
  if (actions.length === 0) return null;

  return (
    <div className="quick-actions">
      {actions.map(({ label, to, icon: Icon }) => (
        <Button key={to} variant="outline" onClick={() => navigate(to)}>
          {label}
          <Icon size={16} />
        </Button>
      ))}
    </div>
  );
};

export default QuickActions;
