import React, { createContext, useCallback, useContext, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
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
  MapPin,
  Timer,
  Clock,
  Ticket,
  MessageSquare,
  Receipt,
  ClipboardList,
  Banknote,
  Users,
  Truck,
  ScrollText,
  KeyRound,
  BookOpen,
  NotebookPen,
  Printer,
  LogOut,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Wrench,
  Image,
  Megaphone,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getCurrentUserRoles, hasAdminPermission, isAdminSide } from '../utils/auth';
import { useStaffPermissions } from '../context/StaffPermissionsContext';
import { useMobileNav } from '../context/MobileNavContext';
import { logout } from '../services/auth.service';
import './Sidebar.css';

// ── Collapse context ───────────────────────────────────────────────────────────
// Desktop icon-only collapse and the mobile off-canvas drawer are two
// different concerns (persisted preference vs. transient overlay state), but
// every role-specific <aside> below needs both to build its className, so
// they're threaded through the same context to avoid prop drilling.
interface CollapseCtx { collapsed: boolean; toggle: () => void; mobileOpen: boolean }
const SidebarCollapseContext = createContext<CollapseCtx>({ collapsed: false, toggle: () => {}, mobileOpen: false });
const useSidebarCollapse = () => useContext(SidebarCollapseContext);

const asideClassName = (collapsed: boolean, mobileOpen: boolean) =>
  `sidebar${collapsed ? ' sidebar--collapsed' : ''}${mobileOpen ? ' sidebar--mobile-open' : ''}`;

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

/** `end` matches the path exactly. A parent path like /accounting needs it, or
 *  it stays active on every child route and lights up alongside them. */
interface SubItemProps { to: string; icon: LucideIcon; label: string; badge?: number; end?: boolean }

const SubItem: React.FC<SubItemProps> = ({ to, icon: Icon, label, badge, end }) => {
  const { collapsed } = useSidebarCollapse();
  return (
    <NavLink
      to={to}
      end={end}
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

/**
 * A section that folds away.
 *
 * Finance has more than a dozen leaves across three levels, which is too many
 * to leave permanently open beside every other section. `match` is the path
 * prefix the group owns: the group holding the current route starts open, so
 * arriving by URL or by refresh shows you where you are rather than making you
 * hunt for it. Toggling afterwards is the user's business.
 *
 * Collapsed to icons, the children render unconditionally — labels are hidden at
 * that width anyway, so a closed group would just be a row of missing icons.
 */
interface SidebarGroupProps {
  label: string;
  icon: LucideIcon;
  /**
   * Path prefix this group owns, e.g. "/accounting/transactions". Several
   * prefixes when a group gathers screens that live at unrelated paths — the
   * merged ones (KYC under Vendor Management, Billing under Vendor COD) kept
   * their original routes, so the group has to claim each of them.
   */
  match: string | string[];
  children: React.ReactNode;
}

const SidebarGroup: React.FC<SidebarGroupProps> = ({ label, icon: Icon, match, children }) => {
  const { collapsed } = useSidebarCollapse();
  const { pathname } = useLocation();
  const holdsCurrentRoute = (Array.isArray(match) ? match : [match]).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const [open, setOpen] = useState(holdsCurrentRoute);

  // Navigating into the group from outside it (a link on a page, the back
  // button) opens it too — otherwise the active leaf would be hidden inside a
  // closed group.
  const [lastMatched, setLastMatched] = useState(holdsCurrentRoute);
  if (holdsCurrentRoute !== lastMatched) {
    setLastMatched(holdsCurrentRoute);
    if (holdsCurrentRoute) setOpen(true);
  }

  const expanded = collapsed || open;

  return (
    <>
      <button
        type="button"
        className={`sidebar-group-toggle ${holdsCurrentRoute ? 'has-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expanded}
        title={collapsed ? label : undefined}
      >
        <Icon size={16} style={{ flexShrink: 0 }} />
        <span className="sidebar-label">{label}</span>
        <ChevronDown size={14} className="sidebar-group-chevron" aria-hidden="true" />
      </button>
      {expanded && <div className="sidebar-subnav">{children}</div>}
    </>
  );
};

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
  const { collapsed, mobileOpen } = useSidebarCollapse();
  return (
    <aside className={asideClassName(collapsed, mobileOpen)}>
      <SidebarToggleBtn />
      <div className="sidebar-nav">
        <SidebarItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
        <SidebarItem to="/orders" icon={Package} label="Orders" />

        <SidebarSection label="Finance" />
        <div className="sidebar-subnav">
          <SubItem to="/finance/settlements" icon={Banknote} label="Settlements" />
          <SubItem to="/vendor/cod-settlement-requests" icon={Banknote} label="Request COD" />
          <SubItem to="/finance/order-payments" icon={ClipboardList} label="Order Payments" />
          <SubItem to="/finance/pending-cod" icon={Receipt} label="Pending COD" />
          <SubItem to="/finance/billing" icon={Wallet} label="Billing & Payments" />
        </div>

        {/* Tickets and Remarks are the two ways a vendor asks us something, so
            they group together rather than sitting under Account beside user
            management and delivery charges. Same pairing the admin and sales
            sidebars already make under "Customer Experience" - the vendor-facing
            name for it is Support. */}
        <SidebarSection label="Support" />
        <div className="sidebar-subnav">
          <SubItem to="/tickets" icon={Ticket} label="Tickets" />
          <SubItem to="/remarks" icon={MessageSquare} label="Remarks" />
        </div>

        <SidebarSection label="Account" />
        <SidebarItem to="/user-management" icon={Users} label="User Management" />
        <SidebarItem to="/delivery-charges" icon={Truck} label="Delivery Charges" />

        {/* Setup-once items, not daily nav - Print Settings (a printer
            preference) and Developer (API keys/webhooks) are unrelated
            concerns, kept as separate pages, just grouped here so they don't
            compete for attention with the items a vendor uses every day. */}
        <SidebarSection label="Settings" />
        <div className="sidebar-subnav">
          <SubItem to="/print-settings" icon={Printer} label="Print Settings" />
          <SubItem to="/developer/api-keys" icon={KeyRound} label="Developer" />
        </div>
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
  const { collapsed, mobileOpen } = useSidebarCollapse();
  const has = (p: string) => perms.includes(p);

  return (
    <aside className={asideClassName(collapsed, mobileOpen)}>
      <SidebarToggleBtn />
      <div className="sidebar-nav">
        {has('DASHBOARD_ACCESS') && (
          <SidebarItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
        )}
        {has('ORDER_ACCESS') && <SidebarItem to="/orders" icon={Package} label="Orders" />}
        {has('FINANCE_ACCESS') && (
          <>
            <SidebarSection label="COD Management" />
            <div className="sidebar-subnav">
              <SubItem to="/finance/settlements" icon={Banknote} label="Settlements" />
              <SubItem to="/vendor/cod-settlement-requests" icon={Banknote} label="Request COD" />
              <SubItem to="/finance/order-payments" icon={ClipboardList} label="Order Payments" />
              <SubItem to="/finance/pending-cod" icon={Receipt} label="Pending COD" />
              <SubItem to="/finance/billing" icon={Wallet} label="Billing & Payments" />
            </div>
          </>
        )}
        {/* Grouped as on the vendor owner's sidebar. The header is gated on the
            two permissions together, so a staff member with neither does not
            get a "Support" heading with nothing under it. */}
        {(has('TICKETS_ACCESS') || has('REMARKS_ACCESS')) && (
          <>
            <SidebarSection label="Support" />
            <div className="sidebar-subnav">
              {has('TICKETS_ACCESS') && <SubItem to="/tickets" icon={Ticket} label="Tickets" />}
              {has('REMARKS_ACCESS') && <SubItem to="/remarks" icon={MessageSquare} label="Remarks" />}
            </div>
          </>
        )}
        {has('USER_ACCESS') && <SidebarItem to="/user-management" icon={Users} label="User Management" />}
        {has('DELIVERY_CHARGES_ACCESS') && <SidebarItem to="/delivery-charges" icon={Truck} label="Delivery Charges" />}

        {has('ORDER_ACCESS') && (
          <>
            <SidebarSection label="Settings" />
            <div className="sidebar-subnav">
              <SubItem to="/print-settings" icon={Printer} label="Print Settings" />
            </div>
          </>
        )}
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
  const { collapsed, mobileOpen } = useSidebarCollapse();
  return (
    <aside className={asideClassName(collapsed, mobileOpen)}>
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
  const { collapsed, mobileOpen } = useSidebarCollapse();
  const canReadBooks = isSuperAdmin || hasAdminPermission('ACCOUNTING_ACCESS');
  const canOpenSystem =
    isSuperAdmin || hasAdminPermission('SYSTEM_LOGS_ACCESS') || hasAdminPermission('SETTINGS_ACCESS');
  return (
    <aside className={asideClassName(collapsed, mobileOpen)}>
      <SidebarToggleBtn />
      <div className="sidebar-nav">
        <SidebarItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
        <SidebarItem to="/orders" icon={Package} label="Orders" />

        <SidebarSection label="Management" />
        {/* Three peers in one column. KYC used to be a fourth entry here; it is
            now the second tab of the Vendor Management page, since an
            application is a vendor account before it has been approved. */}
        <SidebarItem to="/admin" icon={UserCheck} label="Admin Management" />
        <SidebarItem to="/vendors" icon={Store} label="Vendor Management" />
        <SidebarItem to="/riders" icon={Bike} label="Rider Management" />
        {(isSuperAdmin || hasAdminPermission('SETTINGS_ACCESS')) && (
          <SidebarItem to="/settings" icon={MapPin} label="Destination Management" />
        )}
        {/* COD Management used to sit here. It was the rider and vendor
            settlement lists behind a toggle, which is exactly what Rider COD
            and Vendor COD are under Finance below — and Billing & Credit has
            followed the vendor half down there too. */}

        {/* Configuration and audit — the screens nobody opens daily. Folded
            away inside Management so they cost one row until you need them. */}
        {canOpenSystem && (
          <SidebarGroup
            label="System Management"
            icon={Wrench}
            match={['/pickup-time-slots', '/system-logs', '/sla', '/banners', '/announcements']}
          >
            {isSuperAdmin && <SubItem to="/pickup-time-slots" icon={Clock} label="Pickup Time Slots" />}
            {(isSuperAdmin || hasAdminPermission('SYSTEM_LOGS_ACCESS')) && (
              <SubItem to="/system-logs" icon={ScrollText} label="System Logs" />
            )}
            {isSuperAdmin && <SubItem to="/sla" icon={Timer} label="SLA" />}
            {(isSuperAdmin || hasAdminPermission('SETTINGS_ACCESS')) && (
              <SubItem to="/banners" icon={Image} label="Banner" />
            )}
            {(isSuperAdmin || hasAdminPermission('SETTINGS_ACCESS')) && (
              <SubItem to="/announcements" icon={Megaphone} label="Announcements" />
            )}
          </SidebarGroup>
        )}

        {/* Accounting. Gated on the same permission the routes and the API
            check, so the section simply isn't there for staff who weren't
            granted it — rather than being visible and then refusing. */}
        {/* The books, named the way a Tally user already expects: the two COD
            registers, the day book, the ledger, and the cash and bank sides of
            the cash book.

            One level shallower than it was. Rider COD and Vendor COD used to
            sit inside a "Transactions" group, which put a daily screen behind
            two disclosures; they are top-level here, with Vendor COD keeping
            its own three screens beneath it.

            Rider COD and Vendor COD are also the exception to the
            ACCOUNTING_ACCESS gate: they are the settlement lists that used to
            be COD Management, which every admin could reach. Hiding them behind
            a grant would take a daily screen away from the people who use it,
            so an admin without the grant sees those and nothing else here. */}
        <SidebarSection label="Finance" />
        <div className="sidebar-subnav">
          <SubItem to="/accounting/transactions/rider-cod" icon={Bike} label="Rider COD" />

          {/* Vendor COD keeps its three screens together: the settlements
              themselves, what the vendor has asked to be paid before any of it
              becomes a settlement, and the invoice side of the same
              relationship. One vendor conversation, three views of it. */}
          <SidebarGroup
            label="Vendor COD"
            icon={Store}
            match={['/accounting/transactions/vendor-cod', '/cod-settlement-requests', '/billing']}
          >
            <SubItem to="/accounting/transactions/vendor-cod" icon={Store} label="COD & Settlements" />
            <SubItem to="/cod-settlement-requests" icon={Banknote} label="Settlement Requests" />
            <SubItem to="/billing" icon={Receipt} label="Billing & Credit" />
          </SidebarGroup>

          {canReadBooks && (
            <>
              <SubItem to="/accounting/transactions/journal" icon={NotebookPen} label="Journal" />
              {/* Every cash and bank concern in one disclosure instead of
                  three: the group summary (opening/movement/closing per
                  ledger, with Payment/Receipt one key away) and the four
                  scope registers that used to sit in their own separate
                  Cash and Bank groups beside it. */}
              <SidebarGroup
                label="Cash & Bank"
                icon={Wallet}
                match={['/finance/cash-bank', '/accounting/transactions/cash', '/accounting/transactions/bank']}
              >
                <SubItem to="/finance/cash-bank" icon={Wallet} label="Overview" end />
                <SubItem to="/accounting/transactions/cash/receipts" icon={Receipt} label="Cash Receipts" />
                <SubItem to="/accounting/transactions/cash/payments" icon={Banknote} label="Cash Payments" />
                <SubItem to="/accounting/transactions/bank/receipts" icon={Receipt} label="Bank Receipts" />
                <SubItem to="/accounting/transactions/bank/payments" icon={CreditCard} label="Bank Payments" />
              </SidebarGroup>

              {/* One ledger, three groupings of it: any account from the
                  chart, and the two control accounts broken down per party.
                  The children are unqualified because the group already says
                  Ledger - "Ledger > Vendor Ledger" reads as two of them.
                  /finance/ledger is in the match so the printable sheets these
                  drill into keep the group open. */}
              <SidebarGroup
                label="Ledger"
                icon={BookOpen}
                match={['/accounting/ledgers', '/finance/ledger']}
              >
                <SubItem to="/accounting/ledgers/account" icon={BookOpen} label="Account" />
                <SubItem to="/accounting/ledgers/vendor" icon={Store} label="Vendor" />
                <SubItem to="/accounting/ledgers/rider" icon={Bike} label="Rider" />
              </SidebarGroup>
            </>
          )}

          {/* Editing the chart reinterprets posted history, so it is a
              super_admin job rather than part of the books grant. */}
          {isSuperAdmin && <SubItem to="/finance/masters" icon={FileText} label="Masters" />}
        </div>

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
  const { mobileOpen, closeMobile } = useMobileNav();

  return (
    <SidebarCollapseContext.Provider value={{ collapsed, toggle, mobileOpen }}>
      {/* Only present (and only visible, via CSS) below the drawer breakpoint;
          tapping it dismisses the drawer without needing to find the toggle. */}
      {mobileOpen && (
        <div className="sidebar-backdrop" onClick={closeMobile} aria-hidden="true" />
      )}
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
