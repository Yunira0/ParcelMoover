import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, Phone } from 'lucide-react';
import { getCurrentUser } from '../utils/auth';
import { PHONE_DISPLAY, PHONE_TEL } from '../constants/contact';
import './MainLayout.css';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAuthed = Boolean(getCurrentUser());

  // Reset during render (not an effect) when the route changes mid-session -
  // the React-recommended way to adjust state off a changing value without
  // an extra render pass. See https://react.dev/learn/you-might-not-need-an-effect
  const [menuOpenForPath, setMenuOpenForPath] = useState(location.pathname);
  if (location.pathname !== menuOpenForPath) {
    setMenuOpenForPath(location.pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <div className="public-layout">
      <header className="public-header">
        <div className="public-header-inner">
          <Link to="/" className="app-logo">
            Parcel<span>Moover</span>
          </Link>

          <nav className="header-nav" aria-label="Primary">
            <Link to="/track" className={location.pathname.startsWith('/track') ? 'nav-link is-active' : 'nav-link'}>
              Track a Parcel
            </Link>
            <Link to="/apply" className="nav-link">
              Become a Vendor
            </Link>
            <a href={PHONE_TEL} className="nav-link nav-link-phone">
              <Phone size={14} /> {PHONE_DISPLAY}
            </a>
          </nav>

          <div className="header-actions">
            <Link to={isAuthed ? '/dashboard' : '/login'} className="btn btn-secondary">
              {isAuthed ? 'Dashboard' : 'Login'}
            </Link>
          </div>

          <button
            type="button"
            className="header-menu-toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="public-mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        <div id="public-mobile-nav" className={`public-mobile-nav${menuOpen ? ' is-open' : ''}`}>
          <div className="public-mobile-nav-inner">
            <Link to="/track" className="nav-link">Track a Parcel</Link>
            <Link to="/apply" className="nav-link">Become a Vendor</Link>
            <a href={PHONE_TEL} className="nav-link">
              <Phone size={14} /> Call or WhatsApp {PHONE_DISPLAY}
            </a>
            <Link to={isAuthed ? '/dashboard' : '/login'} className="btn btn-primary btn-full">
              {isAuthed ? 'Go to Dashboard' : 'Login'}
            </Link>
          </div>
        </div>
      </header>

      <main className="public-main">
        {children}
      </main>

      <footer className="public-footer">
        <div className="public-footer-inner">
          <div className="footer-brand">
            <span className="app-logo">Parcel<span>Moover</span></span>
            <p>Pickup, delivery, and COD settlement for vendors shipping across the Kathmandu valley and beyond.</p>
            <a href={PHONE_TEL} className="footer-phone">
              <Phone size={14} /> {PHONE_DISPLAY}
            </a>
          </div>

          <div className="footer-links">
            <span className="footer-links-heading">Shipping</span>
            <Link to="/apply">Become a Vendor</Link>
            <Link to="/track">Track a Parcel</Link>
          </div>

          <div className="footer-links">
            <span className="footer-links-heading">Account</span>
            <Link to={isAuthed ? '/dashboard' : '/login'}>{isAuthed ? 'Dashboard' : 'Login'}</Link>
          </div>
        </div>

        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} ParcelMoover. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default MainLayout;
