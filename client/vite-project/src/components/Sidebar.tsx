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
  MessageSquare,
  Receipt,
  ClipboardList,
  Banknote,
  Users,
  Truck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getCurrentUserRoles, isAdminSide } from '../utils/auth';
import { useStaffPermissions } from '../context/StaffPermissionsContext';
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
  remarks: MessageSquare,
  pendingCod: Receipt,
  orderPayments: ClipboardList,
  settlements: Banknote,
  userManagement: Users,
  deliveryCharges: Truck,
};

// Vendors get a focused nav scoped to what their role can actually access -
// the admin-only sections (Admin/Vendor/Rider Management, Operations, CX)
// would just 403 on the backend, so there's no reason to show them.
const VendorSidebar: React.FC = () => (
  <aside className="sidebar">
    <div className="sidebar-nav">
      <SidebarItem to="/dashboard" icon={icons.dashboard} label="Dashboard" />
      <SidebarItem to="/orders" icon={icons.order} label="Order" />

      <div className="sidebar-dropdown">
        <span className="dropdown-label">Finance</span>
        <ChevronDown size={16} style={{ color: 'var(--color-text-caption)' }} />
      </div>
      <div className="sidebar-subnav">
        <NavLink to="/finance/settlements" className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}>
          <icons.settlements className="sidebar-icon" size={24} />
          <span className="sidebar-label">Settlement</span>
        </NavLink>
        <NavLink to="/finance/order-payments" className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}>
          <icons.orderPayments className="sidebar-icon" size={24} />
          <span className="sidebar-label">Order wise payment</span>
        </NavLink>
        <NavLink to="/finance/pending-cod" className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}>
          <icons.pendingCod className="sidebar-icon" size={24} />
          <span className="sidebar-label">Pending COD</span>
        </NavLink>
      </div>

      <SidebarItem to="/user-management" icon={icons.userManagement} label="User Management" />
      <SidebarItem to="/tickets" icon={icons.ticket} label="Tickets" />
      <SidebarItem to="/delivery-charges" icon={icons.deliveryCharges} label="Delivery Charges" />
    </div>

    <div className="sidebar-footer">
      <SidebarItem to="/help" icon={icons.help} label="Help and Support" />
    </div>
  </aside>
);

// Sidebar for vendor_staff — shows only sections the vendor granted them access to.
const VendorStaffSidebar: React.FC = () => {
  const perms = useStaffPermissions();
  const has = (p: string) => perms.includes(p);

  return (
    <aside className="sidebar">
      <div className="sidebar-nav">
        {has('DASHBOARD_ACCESS') && (
          <SidebarItem to="/dashboard" icon={icons.dashboard} label="Dashboard" />
        )}
        {has('ORDER_ACCESS') && (
          <SidebarItem to="/orders" icon={icons.order} label="Order" />
        )}
        {has('FINANCE_ACCESS') && (
          <>
            <div className="sidebar-dropdown">
              <span className="dropdown-label">Finance</span>
              <ChevronDown size={16} style={{ color: 'var(--color-text-caption)' }} />
            </div>
            <div className="sidebar-subnav">
              <NavLink to="/finance/settlements" className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}>
                <icons.settlements className="sidebar-icon" size={24} />
                <span className="sidebar-label">Settlement</span>
              </NavLink>
              <NavLink to="/finance/order-payments" className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}>
                <icons.orderPayments className="sidebar-icon" size={24} />
                <span className="sidebar-label">Order wise payment</span>
              </NavLink>
              <NavLink to="/finance/pending-cod" className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}>
                <icons.pendingCod className="sidebar-icon" size={24} />
                <span className="sidebar-label">Pending COD</span>
              </NavLink>
            </div>
          </>
        )}
        {has('TICKETS_ACCESS') && (
          <SidebarItem to="/tickets" icon={icons.ticket} label="Tickets" />
        )}
        {has('USER_ACCESS') && (
          <SidebarItem to="/user-management" icon={icons.userManagement} label="User Management" />
        )}
        {has('REMARKS_ACCESS') && (
          <SidebarItem to="/remarks" icon={icons.remarks} label="Remarks" />
        )}
        {has('DELIVERY_CHARGES_ACCESS') && (
          <SidebarItem to="/delivery-charges" icon={icons.deliveryCharges} label="Delivery Charges" />
        )}
      </div>
      <div className="sidebar-footer">
        <SidebarItem to="/help" icon={icons.help} label="Help and Support" />
      </div>
    </aside>
  );
};

const AdminSidebar: React.FC<{ isSuperAdmin: boolean }> = ({ isSuperAdmin }) => (
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
        <NavLink
          to="/remarks"
          className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}
        >
          <icons.remarks className="sidebar-icon" size={24} />
          <span className="sidebar-label">Remarks</span>
        </NavLink>
      </div>
    </div>

    <div className="sidebar-footer">
      <SidebarItem to="/help" icon={icons.help} label="Help and Support" />
    </div>
  </aside>
);

const Sidebar: React.FC = () => {
  const roles = getCurrentUserRoles();

  if (roles.includes('vendor_staff')) return <VendorStaffSidebar />;
  if (roles.includes('vendor') && !isAdminSide()) return <VendorSidebar />;
  return <AdminSidebar isSuperAdmin={roles.includes('super_admin')} />;
};

export default Sidebar;
