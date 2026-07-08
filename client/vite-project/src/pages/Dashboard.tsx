import React, { useCallback, useEffect, useState } from 'react';
import StatCard from '../components/StatCard';
import CODSettlement from '../components/CODSettlement';
import TodayOverview from '../components/TodayOverview';
import WeeklyStats from '../components/WeeklyStats';
import DashboardHeader from '../components/DashboardHeader';
import Button from '../components/Button';
import { getDashboardSummary, type DashboardSummary } from '../services/orders.service';
import { getCurrentUser } from '../utils/auth';
import { 
  ClipboardList, 
  RefreshCw,
  RotateCcw, 
  Truck, 
  PackageCheck 
} from 'lucide-react';
import './Dashboard.css';

const REFRESH_INTERVAL_MS = 15_000;

const EMPTY_SUMMARY: DashboardSummary = {
  overview: {
    totalOrders: 0,
    pendingPickups: 0,
    pendingReturns: 0,
    inTransit: 0,
    pendingDeliveries: 0,
    totalDelivered: 0,
    totalReturns: 0,
  },
  today: {
    totalOrders: 0,
    delivered: 0,
    inTransit: 0,
    returns: 0,
    remarks: 0,
    unclosedComments: 0,
  },
  codSettlement: {
    totalCod: 0,
    settledCod: 0,
    pendingCod: 0,
    progressPercent: 0,
    scopedToRider: false,
    lastAmount: 0,
    lastSettledAt: null,
  },
  weeklyTrend: [],
  updatedAt: new Date().toISOString(),
};

const formatUpdatedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'just now';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const Dashboard: React.FC = () => {
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadSummary = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const res = await getDashboardSummary();
      if (res?.success && res.data) {
        setSummary(res.data);
        setError('');
      } else {
        setError('Dashboard data is unavailable.');
      }
    } catch {
      setError('Dashboard data is unavailable.');
    } finally {
      setLoading(false);
      if (showRefreshing) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    const intervalId = window.setInterval(() => loadSummary(), REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (!document.hidden) loadSummary();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadSummary]);

  const stats = [
    {
      icon: ClipboardList,
      label: "PENDING PICKUPS",
      value: loading ? '...' : summary.overview.pendingPickups.toLocaleString()
    },
    {
      icon: RotateCcw,
      label: "Pending Return",
      value: loading ? '...' : summary.overview.pendingReturns.toLocaleString()
    },
    {
      icon: Truck,
      label: "In Transit",
      value: loading ? '...' : summary.overview.inTransit.toLocaleString()
    },
    {
      icon: PackageCheck,
      label: "Pending Deliveries",
      value: loading ? '...' : summary.overview.pendingDeliveries.toLocaleString()
    }
  ];

  return (
    <div className="dashboard-container">
      
      <DashboardHeader
        user={getCurrentUser()?.fullName || ''}
      />
      
      <div className="overview-section">
        <div className="overview-heading">
          <div>
            <h2 className="overview-title">Realtime Overview</h2>
            <p className="overview-meta">
              {error || `Last updated ${formatUpdatedAt(summary.updatedAt)}`}
            </p>
          </div>
          <Button
            variant="secondary"
            className="dashboard-refresh-btn"
            onClick={() => loadSummary(true)}
            disabled={refreshing}
            title="Refresh dashboard"
          >
            <RefreshCw size={16} className={refreshing ? 'spinning' : ''} />
            <span>{refreshing ? 'Refreshing' : 'Refresh'}</span>
          </Button>
        </div>
        <div className="stats-grid">
          {stats.map((stat, index) => (
            <StatCard key={index} {...stat} />
          ))}
        </div>
      </div>
      
      <div className="dashboard-main-grid">
        <div className="grid-left">
          <WeeklyStats />
        </div>
        <div className="grid-right">
          <CODSettlement data={summary.codSettlement} loading={loading} />
          <TodayOverview data={summary.today} loading={loading} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
