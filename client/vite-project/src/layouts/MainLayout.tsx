import React from 'react';
import { Link } from 'react-router-dom';
import './MainLayout.css';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  return (
    <div className="public-layout">
      <header className="public-header">
        <div className="header-content">
          <Link to="/" className="app-logo">
            ParcelMoover
          </Link>
          <nav className="header-nav">
            <Link to="/login" className="nav-link">Login</Link>
          </nav>
        </div>
      </header>
      <main className="public-main">
        {children}
      </main>
      <footer className="public-footer">
        <div className="footer-content">
          <p>&copy; {new Date().getFullYear()} ParcelMoover. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default MainLayout;
