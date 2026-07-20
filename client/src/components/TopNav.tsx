import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight, Bell, User, Package, Truck, Banknote, Menu, MessageSquare, X } from 'lucide-react';
import Button from './Button';
import type { AppNotification } from '../services/notifications.service';
import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToNotificationStream,
} from '../services/notifications.service';
import { getUnclosedRemarksCount, subscribeToRemarkStatusChanged } from '../services/remarks.service';
import { useMobileNav } from '../context/MobileNavContext';
import './TopNav.css';

const timeAgo = (iso: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

// Polling interval for SSE fallback (30 seconds)
const POLL_INTERVAL_MS = 30_000;

const TopNav: React.FC = () => {
  const navigate = useNavigate();
  const { toggleMobile } = useMobileNav();
  const [query, setQuery] = useState('');
  // Below the breakpoint the search field is collapsed to an icon; this
  // expands it to take over the bar, same pattern as most mobile search UIs.
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unclosedCount, setUnclosedCount] = useState(0);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const sseConnectedRef = useRef(true);

  const refreshUnreadCount = useCallback(() => {
    getUnreadNotificationCount().then(setUnreadCount).catch(() => {});
  }, []);

  const refreshUnclosedCount = useCallback(() => {
    getUnclosedRemarksCount()
      .then((res) => {
        if (res?.success && res.data?.count !== undefined) {
          setUnclosedCount(res.data.count);
        }
      })
      .catch(() => {});
  }, []);

  const runSearch = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsSearchOpen(false);
    navigate(`/orders?search=${encodeURIComponent(trimmed)}`);
  };

  useEffect(() => {
    refreshUnreadCount();
    refreshUnclosedCount();

    const unsubscribe = subscribeToNotificationStream((notification) => {
      sseConnectedRef.current = true;
      setNotifications((prev) => [notification, ...prev]);
      setUnreadCount((prev) => prev + 1);
    });

    // Remarks have no SSE stream - refetch immediately whenever a remark is
    // closed/reopened anywhere in this tab (Remarks/UnclosedRemarks/RemarkDetail).
    const unsubscribeRemarks = subscribeToRemarkStatusChanged(refreshUnclosedCount);

    // Polling fallback: catches changes made in other tabs/by other users, and
    // covers the notification SSE stream missing events (tab backgrounded,
    // connection drop).
    const pollTimer = setInterval(() => {
      refreshUnreadCount();
      refreshUnclosedCount();
    }, POLL_INTERVAL_MS);

    return () => {
      unsubscribe();
      unsubscribeRemarks();
      clearInterval(pollTimer);
    };
  }, [refreshUnreadCount, refreshUnclosedCount]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleNotifications = () => {
    const next = !isNotificationsOpen;
    setIsNotificationsOpen(next);
    if (next) {
      getNotifications().then((res) => setNotifications(res.data)).catch(() => {});
    }
  };

  const resolveTrackingId = (notification: AppNotification): string | null => {
    if (notification.trackingId) return notification.trackingId;
    const match = notification.title.match(/PM-[0-9]{6}-[A-Z0-9]{13}-[A-Z0-9]/);
    return match ? match[0] : null;
  };

  const resolveNavigationPath = (notification: AppNotification): string | null => {
    // Prefer explicit link field
    if (notification.link) return notification.link;

    // Fallback: extract tracking ID and navigate to order detail
    const trackingId = resolveTrackingId(notification);
    if (trackingId) return `/orders/track/${trackingId}`;

    // Type-based fallback routes
    switch (notification.type) {
      case 'pickup':
        return '/pickup-operations';
      case 'dispatch':
        return '/dispatch-operations';
      case 'cod_settlement':
        return '/finance';
      default:
        return null;
    }
  };

  const handleNotificationClick = async (notification: AppNotification) => {
    if (!notification.readAt) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      try {
        await markNotificationRead(notification.id);
      } catch {
        // best-effort - the unread badge will self-correct on next fetch
      }
    }
    const path = resolveNavigationPath(notification);
    if (path) {
      setIsNotificationsOpen(false);
      navigate(path);
    }
  };

  const handleMarkAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
    } catch {
      // best-effort - the unread badge will self-correct on next fetch
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'pickup':
        return <Package size={14} className="notification-icon notification-icon-pickup" />;
      case 'dispatch':
        return <Truck size={14} className="notification-icon notification-icon-dispatch" />;
      case 'cod_settlement':
        return <Banknote size={14} className="notification-icon notification-icon-cod" />;
      default:
        return null;
    }
  };

  return (
    <nav className={`top-nav ${isSearchOpen ? 'top-nav--search-open' : ''}`}>
      <button
        type="button"
        className="mobile-menu-btn"
        onClick={toggleMobile}
        aria-label="Open navigation menu"
      >
        <Menu size={22} />
      </button>

      <div className="top-nav-logo">
        {/* Logo removed as requested */}
      </div>

      <form
        className="top-nav-search"
        onSubmit={(event) => { event.preventDefault(); runSearch(); }}
      >
        <div className="search-input-wrapper">
          <Search size={16} style={{ color: 'var(--color-text-caption)' }} />
          <input
            type="text"
            placeholder="Search number, name, tracking id"
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus={isSearchOpen}
          />
          <button
            type="button"
            className="search-close-btn"
            onClick={() => setIsSearchOpen(false)}
            aria-label="Close search"
          >
            <X size={16} />
          </button>
        </div>
        <Button type="submit" variant="primary" className="search-button">
          Search
          <ArrowRight size={16} />
        </Button>
      </form>

      <button
        type="button"
        className="mobile-search-btn"
        onClick={() => setIsSearchOpen(true)}
        aria-label="Search"
      >
        <Search size={20} />
      </button>

      <div className="top-nav-profile">
        <Button
          variant="outline"
          className="cmt-button"
          onClick={() => navigate('/unclosed-remarks')}
          aria-label={`Unclosed comments${unclosedCount > 0 ? `, ${unclosedCount > 99 ? '99+' : unclosedCount}` : ''}`}
        >
          <MessageSquare size={16} />
          <span className="cmt-label">Unclosed cmt</span>
          {unclosedCount > 0 && (
            <span className="cmt-badge" aria-hidden="true">
              {unclosedCount > 99 ? '99+' : unclosedCount}
            </span>
          )}
        </Button>

        <div className="notification-bell" ref={notificationsRef}>
          <button
            type="button"
            className="notification-bell-trigger"
            onClick={toggleNotifications}
            aria-label="Notifications"
          >
            <Bell size={24} style={{ color: 'var(--color-text-primary)' }} />
            {unreadCount > 0 && (
              <span className="notification-badge" aria-label={`${unreadCount} unread notifications`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {isNotificationsOpen && (
            <div className="notification-panel">
              <div className="notification-panel-header">
                <span>Notifications</span>
                {unreadCount > 0 && (
                  <button type="button" className="notification-mark-all" onClick={handleMarkAllRead}>
                    Mark all as read
                  </button>
                )}
              </div>
              <div className="notification-panel-list">
                {notifications.length === 0 ? (
                  <div className="notification-panel-empty">No notifications yet</div>
                ) : (
                  notifications.map((notification) => (
                    <button
                      type="button"
                      key={notification.id}
                      className={`notification-item notification-item--${notification.type || 'general'} ${notification.readAt ? '' : 'notification-item-unread'}`}
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <div className="notification-item-header">
                        {getNotificationIcon(notification.type)}
                        <span className="notification-item-title">{notification.title}</span>
                      </div>
                      {notification.body && (
                        <div className="notification-item-body">{notification.body}</div>
                      )}
                      <div className="notification-item-time">{timeAgo(notification.createdAt)}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="user-profile"
          onClick={() => navigate('/profile')}
          title="My profile"
        >
          <User size={20} style={{ color: 'var(--color-background-surface)' }} />
        </button>
      </div>
    </nav>
  );
};

export default TopNav;
