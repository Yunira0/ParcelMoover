import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight, Info, Bell, User } from 'lucide-react';
import Button from './Button';
import type { AppNotification } from '../services/notifications.service';
import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToNotificationStream,
} from '../services/notifications.service';
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

const TopNav: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const runSearch = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    navigate(`/orders?search=${encodeURIComponent(trimmed)}`);
  };

  useEffect(() => {
    getUnreadNotificationCount().then(setUnreadCount).catch(() => {});

    const unsubscribe = subscribeToNotificationStream((notification) => {
      setNotifications((prev) => [notification, ...prev]);
      setUnreadCount((prev) => prev + 1);
    });
    return unsubscribe;
  }, []);

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

  return (
    <nav className="top-nav">
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
          />
        </div>
        <Button type="submit" variant="primary" className="search-button">
          Search
          <ArrowRight size={16} />
        </Button>
      </form>

      <div className="top-nav-profile">
        <Button variant="outline" className="cmt-button">
          Unclosed cmt
          <Info size={16} style={{ color: 'var(--color-text-primary)' }} />
        </Button>
        
        <div className="notification-bell" ref={notificationsRef}>
          <button
            type="button"
            className="notification-bell-trigger"
            onClick={toggleNotifications}
            aria-label="Notifications"
          >
            <Bell size={24} style={{ color: 'var(--color-text-primary)' }} />
            {unreadCount > 0 && <div className="bell-dot"></div>}
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
                      className={`notification-item ${notification.readAt ? '' : 'notification-item-unread'}`}
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <div className="notification-item-title">{notification.title}</div>
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

        <div className="user-profile">
          <User size={20} style={{ color: 'var(--color-background-surface)' }} />
        </div>
      </div>
    </nav>
  );
};

export default TopNav;
