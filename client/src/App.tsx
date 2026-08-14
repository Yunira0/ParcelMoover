import { lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout'
import DashboardLayout from './layouts/DashboardLayout'
import Home from './pages/Home'
import TrackParcel from './pages/TrackParcel'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import ProtectedRoute from './components/ProtectedRoute'
import PublicOnlyRoute from './components/PublicOnlyRoute'
import RoleGuard from './components/RoleGuard'
import PageLoader from './components/PageLoader'
import {
  BooksRedirect,
  CodManagementRedirect,
  JournalRedirect,
  LedgerRedirect,
  PartiesRedirect,
  PartyLedgerRedirect,
  PeopleRedirect,
  PeriodsRedirect,
  PersonDetailRedirect,
  ReportsRedirect,
  SearchRedirect,
} from './pages/accounting/legacyRedirects'
import './App.css'

const DashboardRouter = lazy(() => import('./pages/DashboardRouter'))
const OverviewOrdersPage = lazy(() => import('./pages/OverviewOrdersPage'))
const OrdersRouter = lazy(() => import('./pages/OrdersRouter'))
const CreateOrderPage = lazy(() => import('./pages/CreateOrderPage'))
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage'))
const AdminManagement = lazy(() => import('./pages/AdminManagement'))
const AdminFormPage = lazy(() => import('./pages/AdminFormPage'))
const VendorManagement = lazy(() => import('./pages/VendorManagement'))
const VendorFormPage = lazy(() => import('./pages/VendorFormPage'))
const RiderManagement = lazy(() => import('./pages/RiderManagement'))
const RiderFormPage = lazy(() => import('./pages/RiderFormPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const SettlementDetailPage = lazy(() => import('./pages/SettlementDetailPage'))
const SettlementCreatePage = lazy(() => import('./pages/SettlementCreatePage'))
// Accounting (the Finance section) — lazy like every other page group, so the
// ledger screens cost nothing to users who never open them.
const AccountingOverview = lazy(() => import('./pages/accounting/AccountingOverview'))
const TransactionsPage = lazy(() => import('./pages/accounting/TransactionsPage'))
const CodPage = lazy(() => import('./pages/accounting/CodPage'))
const JournalPage = lazy(() => import('./pages/accounting/JournalPage'))
const LedgerReportPage = lazy(() => import('./pages/accounting/LedgerReportPage'))
const PartySearchPage = lazy(() => import('./pages/accounting/PartySearchPage'))
const AccountingPersonPage = lazy(() => import('./pages/accounting/AccountingPersonPage'))
const DeliveryRateSettings = lazy(() => import('./pages/DeliveryRateSettings'))
const Settings = lazy(() => import('./pages/settings/Settings'))
const SlaSettings = lazy(() => import('./pages/SlaSettings'))
const PickupTimeSlots = lazy(() => import('./pages/PickupTimeSlots'))
const PickupOperations = lazy(() => import('./pages/PickupOperations'))
const DispatchOperations = lazy(() => import('./pages/DispatchOperations'))
const OOVOperations = lazy(() => import('./pages/OOVOperations'))
const ReturnOperations = lazy(() => import('./pages/ReturnOperations'))
const HoldOperations = lazy(() => import('./pages/HoldOperations'))
const LossAndDamageOperations = lazy(() => import('./pages/LossAndDamageOperations'))
const RiderRunSheet = lazy(() => import('./pages/RiderRunSheet'))
const CXCenter = lazy(() => import('./pages/CXCenter'))
const Remarks = lazy(() => import('./pages/Remarks'))
const UnclosedRemarks = lazy(() => import('./pages/UnclosedRemarks'))
const RemarkDetail = lazy(() => import('./pages/RemarkDetail'))
const TicketDetail = lazy(() => import('./pages/TicketDetail'))
const VendorSettlements = lazy(() => import('./pages/vendor/VendorSettlements'))
const VendorPendingCod = lazy(() => import('./pages/vendor/VendorPendingCod'))
const VendorOrderPayments = lazy(() => import('./pages/vendor/VendorOrderPayments'))
const VendorBilling = lazy(() => import('./pages/vendor/VendorBilling'))
const BillingManagement = lazy(() => import('./pages/BillingManagement'))
const VendorUserManagement = lazy(() => import('./pages/vendor/VendorUserManagement'))
const VendorApiKeys = lazy(() => import('./pages/vendor/VendorApiKeys'))
const VendorWebhooks = lazy(() => import('./pages/vendor/VendorWebhooks'))
const StaffFormPage = lazy(() => import('./pages/vendor/StaffFormPage'))
const BulkOrderPage = lazy(() => import('./pages/vendor/BulkOrderPage'))
const VendorDeliveryCharges = lazy(() => import('./pages/vendor/VendorDeliveryCharges'))
const VendorMetricDetail = lazy(() => import('./pages/vendor/VendorMetricDetail'))
const ForceChangePasswordPage = lazy(() => import('./pages/ForceChangePasswordPage'))
const KycApplicationPage = lazy(() => import('./pages/KycApplicationPage'))
const SystemLogs = lazy(() => import('./pages/SystemLogs'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))

function App() {

  return (
    <Router>
      <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<PublicOnlyRoute><MainLayout><Home /></MainLayout></PublicOnlyRoute>} />
        <Route path="/track" element={<MainLayout><TrackParcel /></MainLayout>} />
        <Route path="/track/:trackingId" element={<MainLayout><TrackParcel /></MainLayout>} />
        <Route path="/login" element={<MainLayout><Login /></MainLayout>} />
        {/* Standalone — no sidebar/topnav, intentionally outside ProtectedRoute */}
        <Route path="/change-password" element={<ForceChangePasswordPage />} />
        <Route path="/apply" element={<KycApplicationPage />} />

        {/* Protected Dashboard Routes */}
        <Route 
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardRouter />} />
          <Route
            path="/dashboard/metric/:metricId"
            element={<RoleGuard allowedRoles={['vendor', 'vendor_staff', 'sales']}><VendorMetricDetail /></RoleGuard>}
          />
          <Route
            path="/overview/:metric"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><OverviewOrdersPage /></RoleGuard>}
          />
          <Route path="/orders" element={<OrdersRouter />} />
          <Route
            path="/orders/create"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'sales', 'vendor', 'vendor_staff']} requiredPermission="ORDER_ACCESS"><CreateOrderPage /></RoleGuard>}
          />
          {/* vendor/vendor_staff bulk-import for themselves via GET /orders/sender-profile;
              admin/super_admin/sales pick which vendor via a dropdown instead
              (sales is further scoped server-side to vendors they own). */}
          <Route
            path="/orders/bulk-create"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'sales', 'vendor', 'vendor_staff']} requiredPermission="ORDER_ACCESS"><BulkOrderPage /></RoleGuard>}
          />
          {/* Every known role can legitimately track some subset of orders - the
              backend (getOrderByTrackingId) already scopes which specific orders
              each actor can see. This RoleGuard exists to keep the allowlist
              explicit (matching every other route) rather than silently open to
              any future role added to the system. */}
          <Route
            path="/orders/track/:trackingId"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'vendor', 'vendor_staff', 'sales', 'rider']}><OrderDetailPage /></RoleGuard>}
          />
          <Route
            path="/admin"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><AdminManagement /></RoleGuard>}
          />
          {/* Creating/editing fellow admin accounts needs the delegated
              MANAGE_USERS permission (rider/vendor management stays open to
              every admin, matching the server-side rules). */}
          <Route
            path="/admin/new"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="MANAGE_USERS"><AdminFormPage /></RoleGuard>}
          />
          <Route
            path="/admin/:id/edit"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="MANAGE_USERS"><AdminFormPage /></RoleGuard>}
          />
          <Route
            path="/vendors"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'sales']}><VendorManagement /></RoleGuard>}
          />
          <Route
            path="/vendors/new"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'sales']}><VendorFormPage /></RoleGuard>}
          />
          <Route
            path="/vendors/:id/edit"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'sales']}><VendorFormPage /></RoleGuard>}
          />
          {/* KYC review is the second tab of Vendor Management now. The old
              path still resolves so existing links and bookmarks land on it. */}
          <Route path="/kyc-applications" element={<Navigate to="/vendors?tab=kyc" replace />} />
          <Route
            path="/system-logs"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="SYSTEM_LOGS_ACCESS"><SystemLogs /></RoleGuard>}
          />
          <Route
            path="/riders"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><RiderManagement /></RoleGuard>}
          />
          <Route
            path="/riders/new"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><RiderFormPage /></RoleGuard>}
          />
          <Route
            path="/riders/:id/edit"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><RiderFormPage /></RoleGuard>}
          />
          {/* COD Management was this page's rider/vendor toggle; both halves now
              live on their own Finance entry. */}
          <Route path="/finance" element={<CodManagementRedirect />} />
          <Route
            path="/reports"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><ReportsPage /></RoleGuard>}
          />
          <Route
            path="/settings"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="SETTINGS_ACCESS"><Settings /></RoleGuard>}
          />
          <Route
            path="/settings/delivery-rates"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="SETTINGS_ACCESS"><DeliveryRateSettings /></RoleGuard>}
          />
          <Route
            path="/sla"
            element={<RoleGuard allowedRoles={['super_admin']}><SlaSettings /></RoleGuard>}
          />
          <Route
            path="/pickup-time-slots"
            element={<RoleGuard allowedRoles={['super_admin']}><PickupTimeSlots /></RoleGuard>}
          />
          <Route
            path="/pickup"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><PickupOperations /></RoleGuard>}
          />
          <Route
            path="/dispatch"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><DispatchOperations /></RoleGuard>}
          />
          <Route
            path="/oov"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><OOVOperations /></RoleGuard>}
          />
          <Route
            path="/return"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><ReturnOperations /></RoleGuard>}
          />
          <Route
            path="/hold"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><HoldOperations /></RoleGuard>}
          />
          <Route
            path="/loss-and-damage"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><LossAndDamageOperations /></RoleGuard>}
          />
          <Route
            path="/rider-run-sheet"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><RiderRunSheet /></RoleGuard>}
          />
          <Route
            path="/tickets"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'vendor', 'vendor_staff', 'sales']}><CXCenter /></RoleGuard>}
          />
          <Route
            path="/tickets/:id"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'vendor', 'vendor_staff', 'sales']}><TicketDetail /></RoleGuard>}
          />
          <Route
            path="/remarks"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'vendor', 'vendor_staff', 'sales']}><Remarks /></RoleGuard>}
          />
          <Route
            path="/unclosed-remarks"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'vendor', 'vendor_staff', 'sales']}><UnclosedRemarks /></RoleGuard>}
          />
          <Route
            path="/remarks/:id"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'vendor', 'vendor_staff', 'sales']}><RemarkDetail /></RoleGuard>}
          />
          <Route
            path="/finance/settlements/new"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><SettlementCreatePage /></RoleGuard>}
          />
          <Route
            path="/finance/settlements/:id"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'vendor', 'vendor_staff', 'sales']} requiredPermission="FINANCE_ACCESS"><SettlementDetailPage /></RoleGuard>}
          />
          <Route
            path="/finance/settlements"
            element={<RoleGuard allowedRoles={['vendor', 'vendor_staff']} requiredPermission="FINANCE_ACCESS"><VendorSettlements /></RoleGuard>}
          />
          <Route
            path="/finance/pending-cod"
            element={<RoleGuard allowedRoles={['vendor', 'vendor_staff']} requiredPermission="FINANCE_ACCESS"><VendorPendingCod /></RoleGuard>}
          />
          <Route
            path="/finance/order-payments"
            element={<RoleGuard allowedRoles={['vendor', 'vendor_staff']} requiredPermission="FINANCE_ACCESS"><VendorOrderPayments /></RoleGuard>}
          />
          <Route
            path="/finance/billing"
            element={<RoleGuard allowedRoles={['vendor', 'vendor_staff']} requiredPermission="FINANCE_ACCESS"><VendorBilling /></RoleGuard>}
          />
          <Route
            path="/billing"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><BillingManagement /></RoleGuard>}
          />

          {/* Accounting. Every route carries adminPermission so typing the URL
              is no easier than clicking the nav item — the API enforces the
              same grant, this just avoids a pointless round trip. */}
          <Route
            path="/accounting"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="ACCOUNTING_ACCESS"><AccountingOverview /></RoleGuard>}
          />

          {/* Transactions — the four scopes the note asks for. Cash and bank
              each split by direction, which is what "payment" and "receipt"
              mean on a cash book. */}
          {/* Rider and Vendor COD absorbed the old COD Management screen, so
              they keep its access: every admin, no extra grant. */}
          <Route
            path="/accounting/transactions/rider-cod"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><CodPage payeeType="rider" /></RoleGuard>}
          />
          <Route
            path="/accounting/transactions/vendor-cod"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><CodPage payeeType="vendor" /></RoleGuard>}
          />
          <Route
            path="/accounting/transactions/journal"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="ACCOUNTING_ACCESS"><JournalPage /></RoleGuard>}
          />
          <Route
            path="/accounting/transactions/cash/payments"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="ACCOUNTING_ACCESS"><TransactionsPage scope="cash" direction="out" /></RoleGuard>}
          />
          <Route
            path="/accounting/transactions/cash/receipts"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="ACCOUNTING_ACCESS"><TransactionsPage scope="cash" direction="in" /></RoleGuard>}
          />
          <Route
            path="/accounting/transactions/bank/payments"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="ACCOUNTING_ACCESS"><TransactionsPage scope="bank" direction="out" /></RoleGuard>}
          />
          <Route
            path="/accounting/transactions/bank/receipts"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="ACCOUNTING_ACCESS"><TransactionsPage scope="bank" direction="in" /></RoleGuard>}
          />

          {/* Ledger Report — the two control-account subledgers and any single
              account from the chart. */}
          <Route
            path="/accounting/ledgers/vendor"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="ACCOUNTING_ACCESS"><LedgerReportPage view="vendor" /></RoleGuard>}
          />
          <Route
            path="/accounting/ledgers/rider"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="ACCOUNTING_ACCESS"><LedgerReportPage view="rider" /></RoleGuard>}
          />
          <Route
            path="/accounting/ledgers/account"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="ACCOUNTING_ACCESS"><LedgerReportPage view="account" /></RoleGuard>}
          />

          {/* Reached by drilling from a ledger, never from the nav. */}
          <Route
            path="/accounting/people/search"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="ACCOUNTING_ACCESS"><PartySearchPage /></RoleGuard>}
          />
          <Route
            path="/accounting/people/:partyType/:partyId"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']} adminPermission="ACCOUNTING_ACCESS"><AccountingPersonPage /></RoleGuard>}
          />
          {/* The expense screen is gone: an expense was only ever cash leaving
              against a 5xxx account, which the Cash Payments voucher records.
              Entries posted by the old screen are still in the journal. */}
          <Route path="/accounting/expenses" element={<Navigate to="/accounting/transactions/cash/payments" replace />} />

          {/* Superseded Finance paths. Left in so old links and bookmarks still
              land — each carries its query string across and replaces itself in
              history, and the destination route does the permission check. */}
          <Route path="/accounting/books" element={<BooksRedirect />} />
          <Route path="/accounting/people" element={<PeopleRedirect />} />
          <Route path="/accounting/journal" element={<JournalRedirect />} />
          <Route path="/accounting/ledger" element={<LedgerRedirect />} />
          <Route path="/accounting/reports" element={<ReportsRedirect />} />
          <Route path="/accounting/periods" element={<PeriodsRedirect />} />
          <Route path="/accounting/parties" element={<PartiesRedirect />} />
          <Route path="/accounting/parties/:partyType/:id" element={<PartyLedgerRedirect />} />
          <Route path="/accounting/search" element={<SearchRedirect />} />
          <Route path="/accounting/search/:partyType/:partyId" element={<PersonDetailRedirect />} />
          <Route
            path="/user-management"
            element={<RoleGuard allowedRoles={['vendor']}><VendorUserManagement /></RoleGuard>}
          />
          <Route
            path="/user-management/staff/new"
            element={<RoleGuard allowedRoles={['vendor']}><StaffFormPage /></RoleGuard>}
          />
          <Route
            path="/user-management/staff/:id/edit"
            element={<RoleGuard allowedRoles={['vendor']}><StaffFormPage /></RoleGuard>}
          />
          <Route
            path="/delivery-charges"
            element={<RoleGuard allowedRoles={['vendor', 'vendor_staff']} requiredPermission="DELIVERY_CHARGES_ACCESS"><VendorDeliveryCharges /></RoleGuard>}
          />
          <Route
            path="/developer/api-keys"
            element={<RoleGuard allowedRoles={['vendor']}><VendorApiKeys /></RoleGuard>}
          />
          <Route
            path="/developer/webhooks"
            element={<RoleGuard allowedRoles={['vendor']}><VendorWebhooks /></RoleGuard>}
          />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        {/* Catch-all */}
        <Route path="*" element={<MainLayout><NotFound /></MainLayout>} />
      </Routes>
      </Suspense>
    </Router>
  )
}

export default App
