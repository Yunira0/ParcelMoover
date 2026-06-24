import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  UserCheck,
  Store,
  Bike,
  Wallet,
  HelpCircle,
  ChevronDown,
  Archive,
  Send,
  Route,
  RotateCcw,
  OctagonMinus,
  Map,
  Percent,
  Ticket,
  MessageSquare
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import './Sidebar.css';

interface SidebarItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ to, icon: Icon, label }) => {
  return (
    <NavLink 
      to={to} 
      className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
    >
      <Icon className="sidebar-icon" size={24} />
      <span className="sidebar-label">{label}</span>
    </NavLink>
  );
};

const isCurrentUserSuperAdmin = (): boolean => {
  try {
    const roles = JSON.parse(localStorage.getItem('user') || 'null')?.roles;
    return Array.isArray(roles) && roles.includes('super_admin');
  } catch {
    return false;
  }
};

const Sidebar: React.FC = () => {
  const icons = {
    dashboard: LayoutDashboard,
    order: Package,
    admin: UserCheck,
    vendor: Store,
    rider: Bike,
    finance: Wallet,
    help: HelpCircle,
    pickup: Archive,
    dispatch: Send,
    oov: Route,
    return: RotateCcw,
    hold: OctagonMinus,
    damage: Map,
    deliveryRates: Percent,
    ticket: Ticket,
    remarks: MessageSquare
  };

  const isSuperAdmin = isCurrentUserSuperAdmin();

  return (
    <aside className="sidebar">
      <div className="sidebar-nav">
        <SidebarItem to="/dashboard" icon={icons.dashboard} label="Dashboard" />
        <SidebarItem to="/orders" icon={icons.order} label="Order" />
        <SidebarItem to="/admin" icon={icons.admin} label="Admin Management" />
        <SidebarItem to="/vendors" icon={icons.vendor} label="Vendor Management" />
        <SidebarItem to="/riders" icon={icons.rider} label="Rider Management" />
        <SidebarItem to="/finance" icon={icons.finance} label="Finance Management" />
        {isSuperAdmin && (
          <SidebarItem to="/settings/delivery-rates" icon={icons.deliveryRates} label="Delivery Rates" />
        )}

        <div className="sidebar-divider"></div>
        
        <div className="sidebar-dropdown">
           <span className="dropdown-label">Operation</span>
           <ChevronDown size={16} style={{ color: 'var(--color-text-caption)' }} />
        </div>
        <div className="sidebar-subnav">
          <NavLink
            to="/pickup"
            className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}
          >
            <icons.pickup className="sidebar-icon" size={24} />
            <span className="sidebar-label">Pickup</span>
          </NavLink>
          <NavLink
            to="/dispatch"
            className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}
          >
            <icons.dispatch className="sidebar-icon" size={24} />
            <span className="sidebar-label">Dispatch</span>
          </NavLink>
          <NavLink
            to="/oov"
            className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}
          >
            <icons.oov className="sidebar-icon" size={24} />
            <span className="sidebar-label">OOV</span>
          </NavLink>
          <NavLink
            to="/return"
            className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}
          >
            <icons.return className="sidebar-icon" size={24} />
            <span className="sidebar-label">Return</span>
          </NavLink>
          <NavLink
            to="/hold"
            className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}
          >
            <icons.hold className="sidebar-icon" size={24} />
            <span className="sidebar-label">Hold</span>
          </NavLink>
          <NavLink
            to="/loss-and-damage"
            className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}
          >
            <icons.damage className="sidebar-icon" size={24} />
            <span className="sidebar-label">Loss and Damage</span>
          </NavLink>
        </div>
        <div className="sidebar-dropdown">
           <span className="dropdown-label">CX/Tickets</span>
           <ChevronDown size={16} style={{ color: 'var(--color-text-caption)' }} />
        </div>
        <div className="sidebar-subnav">
          <NavLink
            to="/tickets"
            className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}
          >
            <icons.ticket className="sidebar-icon" size={24} />
            <span className="sidebar-label">Tickets</span>
          </NavLink>
          <div className="sidebar-subitem">
            <icons.remarks className="sidebar-icon" size={24} />
            <span className="sidebar-label">Remarks</span>
          </div>
        </div>
      </div>
      
      <div className="sidebar-footer">
        <SidebarItem to="/help" icon={icons.help} label="Help and Support" />
      </div>
    </aside>
  );
};

export default Sidebar;
