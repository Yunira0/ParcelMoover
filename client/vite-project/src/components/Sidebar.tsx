import React, { createContext, useCallback, useContext, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  UserCheck,
  Store,
  Bike,
  Wallet,
  Archive,
  Send,
  Route,
  RotateCcw,
  OctagonMinus,
  Map,
  Settings,
  Ticket,
  MessageSquare,
  Receipt,
  ClipboardList,
  Banknote,
  Users,
  Truck,
  ClipboardCheck,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getCurrentUserRoles, isAdminSide } from '../utils/auth';
import { useStaffPermissions } from '../context/StaffPermissionsContext';
import { logout } from '../services/auth.service';
import './Sidebar.css';

// ── Collapse context ───────────────────────────────────────────────────────────
interface CollapseCtx { collapsed: boolean; toggle: () => void }
const SidebarCollapseContext = createContext<CollapseCtx>({ collapsed: false, toggle: () => {} });
const useSidebarCollapse = () => useContext(SidebarCollapseContext);

// ── Shared atoms ───────────────────────────────────────────────────────────────
interface SidebarItemProps { to: string; icon: LucideIcon; label: string; badge?: number }

const SidebarItem: React.FC<SidebarItemProps> = ({ to, icon: Icon, label, badge }) => {
  const { collapsed } = useSidebarCollapse();
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
      title={collapsed ? label : undefined}
    >
      <Icon className="sidebar-icon" size={18} />
      <span className="sidebar-label">{label}</span>
      {badge != null && badge > 0 && (
        <span className="sidebar-badge" aria-label={`${badge} unread`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
};

interface SubItemProps { to: string; icon: LucideIcon; label: string; badge?: number }

const SubItem: React.FC<SubItemProps> = ({ to, icon: Icon, label, badge }) => {
  const { collapsed } = useSidebarCollapse();
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}
      title={collapsed ? label : undefined}
    >
      <Icon size={15} style={{ flexShrink: 0 }} />
      <span className="sidebar-label">{label}</span>
      {badge != null && badge > 0 && (
        <span className="sidebar-badge" aria-label={`${badge} unread`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
};

const SidebarSection: React.FC<{ label: string }> = ({ label }) => (
  <div className="sidebar-section-label">{label}</div>
);

const SidebarLogout: React.FC = () => {
  const navigate = useNavigate();
  const { collapsed } = useSidebarCollapse();
  const handleLogout = async () => {
    try {
      // Revokes the session server-side (accessToken is httpOnly, so only the
      // server can actually clear it) - best-effort, still log out locally
      // even if this fails (e.g. the token was already expired/invalid).
      await logout();
    } catch {
      // ignore - fall through to local cleanup below regardless
    } finally {
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      navigate('/login');
    }
  };
  return (
    <button
      className="sidebar-logout"
      onClick={handleLogout}
      title={collapsed ? 'Logout' : undefined}
    >
      <LogOut size={18} style={{ flexShrink: 0 }} />
      <span className="sidebar-label">Logout</span>
    </button>
  );
};

const SidebarToggleBtn: React.FC = () => {
  const { collapsed, toggle } = useSidebarCollapse();
  return (
    <div className="sidebar-header">
      <button
        type="button"
        className="sidebar-toggle-btn"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </div>
  );
};

// ── Vendor sidebar ─────────────────────────────────────────────────────────────
const VendorSidebar: React.FC = () => {
  const { collapsed } = useSidebarCollapse();
  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <SidebarToggleBtn />
      <div className="sidebar-nav">
        <SidebarItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
        <SidebarItem to="/orders" icon={Package} label="Orders" />

        <SidebarSection label="Finance" />
        <div className="sidebar-subnav">
          <SubItem to="/finance/settlements" icon={Banknote} label="Settlements" />
          <SubItem to="/finance/order-payments" icon={ClipboardList} label="Order Payments" />
          <SubItem to="/finance/pending-cod" icon={Receipt} label="Pending COD" />
        </div>

        <SidebarSection label="Account" />
        <SidebarItem to="/user-management" icon={Users} label="User Management" />
        <SidebarItem to="/tickets" icon={Ticket} label="Tickets" />
        <SidebarItem to="/delivery-charges" icon={Truck} label="Delivery Charges" />
      </div>

      <div className="sidebar-footer">
        <SidebarLogout />
      </div>
    </aside>
  );
};

// ── Vendor staff sidebar ───────────────────────────────────────────────────────
const VendorStaffSidebar: React.FC = () => {
  const perms = useStaffPermissions();
  const { collapsed } = useSidebarCollapse();
  const has = (p: string) => perms.includes(p);

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <SidebarToggleBtn />
      <div className="sidebar-nav">
        {has('DASHBOARD_ACCESS') && (
          <SidebarItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
        )}
        {has('ORDER_ACCESS') && (
          <SidebarItem to="/orders" icon={Package} label="Orders" />
        )}
        {has('FINANCE_ACCESS') && (
          <>
            <SidebarSection label="COD Management" />
            <div className="sidebar-subnav">
              <SubItem to="/finance/settlements" icon={Banknote} label="Settlements" />
              <SubItem to="/finance/order-payments" icon={ClipboardList} label="Order Payments" />
              <SubItem to="/finance/pending-cod" icon={Receipt} label="Pending COD" />
            </div>
          </>
        )}
        {has('TICKETS_ACCESS') && <SidebarItem to="/tickets" icon={Ticket} label="Tickets" />}
        {has('USER_ACCESS') && <SidebarItem to="/user-management" icon={Users} label="User Management" />}
        {has('REMARKS_ACCESS') && <SidebarItem to="/remarks" icon={MessageSquare} label="Remarks" />}
        {has('DELIVERY_CHARGES_ACCESS') && <SidebarItem to="/delivery-charges" icon={Truck} label="Delivery Charges" />}
      </div>

      <div className="sidebar-footer">
        <SidebarLogout />
      </div>
    </aside>
  );
};

// ── Sales sidebar ──────────────────────────────────────────────────────────────
// Sales accounts only manage their own clients: dashboard, orders, the vendor
// (client) list, and customer-experience (remarks/tickets) — all backend-scoped.
const SalesSidebar: React.FC = () => {
  const { collapsed } = useSidebarCollapse();
  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <SidebarToggleBtn />
      <div className="sidebar-nav">
        <SidebarItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
        <SidebarItem to="/orders" icon={Package} label="Orders" />
        <SidebarItem to="/vendors" icon={Store} label="Vendor Management" />

        <SidebarSection label="Customer Experience" />
        <div className="sidebar-subnav">
          <SubItem to="/tickets" icon={Ticket} label="Tickets" />
          <SubItem to="/remarks" icon={MessageSquare} label="Remarks" />
        </div>
      </div>

      <div className="sidebar-footer">
        <SidebarLogout />
      </div>
    </aside>
  );
};

// ── Admin / super-admin sidebar ────────────────────────────────────────────────
const AdminSidebar: React.FC<{ isSuperAdmin: boolean }> = ({ isSuperAdmin }) => {
  const { collapsed } = useSidebarCollapse();
  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <SidebarToggleBtn />
      <div className="sidebar-nav">
        <SidebarItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
        <SidebarItem to="/orders" icon={Package} label="Orders" />

        <SidebarSection label="Management" />
        <SidebarItem to="/admin" icon={UserCheck} label="Admin Management" />
        <SidebarItem to="/vendors" icon={Store} label="Vendor Management" />
        {isSuperAdmin && <SidebarItem to="/kyc-applications" icon={ClipboardCheck} label="KYC Applications" />}
        <SidebarItem to="/riders" icon={Bike} label="Rider Management" />
        <SidebarItem to="/finance" icon={Wallet} label="COD Management" />
        {isSuperAdmin && <SidebarItem to="/settings" icon={Settings} label="Settings" />}

        <SidebarSection label="Operations" />
        <div className="sidebar-subnav">
          <SubItem to="/pickup" icon={Archive} label="Pickup" />
          <SubItem to="/dispatch" icon={Send} label="Local Dispatch" />
          <SubItem to="/rider-run-sheet" icon={ClipboardList} label="Rider Run Sheet" />
          <SubItem to="/oov" icon={Route} label="Transit" />
          <SubItem to="/return" icon={RotateCcw} label="Return" />
          <SubItem to="/hold" icon={OctagonMinus} label="Hold" />
          <SubItem to="/loss-and-damage" icon={Map} label="Loss & Damage" />
        </div>

        <SidebarSection label="Customer Experience" />
        <div className="sidebar-subnav">
          <SubItem to="/tickets" icon={Ticket} label="Tickets" />
          <SubItem to="/remarks" icon={MessageSquare} label="Remarks" />
        </div>
      </div>

      <div className="sidebar-footer">
        <SidebarLogout />
      </div>
    </aside>
  );
};

// ── Root — owns collapse state, provides context ───────────────────────────────
const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar-collapsed') === 'true',
  );
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  }, []);

  const roles = getCurrentUserRoles();

  return (
    <SidebarCollapseContext.Provider value={{ collapsed, toggle }}>
      {roles.includes('vendor_staff') ? (
        <VendorStaffSidebar />
      ) : roles.includes('vendor') && !isAdminSide() ? (
        <VendorSidebar />
      ) : roles.includes('sales') && !isAdminSide() ? (
        <SalesSidebar />
      ) : (
        <AdminSidebar isSuperAdmin={roles.includes('super_admin')} />
      )}
    </SidebarCollapseContext.Provider>
  );
};

export default Sidebar;
