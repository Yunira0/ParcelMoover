import React from 'react';
import { Search, ArrowRight, Info, Bell, User } from 'lucide-react';
import Button from './Button';
import './TopNav.css';

const TopNav: React.FC = () => {
  return (
    <nav className="top-nav">
      <div className="top-nav-logo">
        {/* Logo removed as requested */}
      </div>
      
      <div className="top-nav-search">
        <div className="search-input-wrapper">
          <Search size={16} style={{ color: 'var(--color-text-caption)' }} />
          <input 
            type="text" 
            placeholder="Search number, name, tracking id" 
            className="search-input"
          />
        </div>
        <Button variant="primary" className="search-button">
          Search
          <ArrowRight size={16} />
        </Button>
      </div>

      <div className="top-nav-profile">
        <Button variant="outline" className="cmt-button">
          Unclosed cmt
          <Info size={16} style={{ color: 'var(--color-text-primary)' }} />
        </Button>
        
        <div className="notification-bell">
          <Bell size={24} style={{ color: 'var(--color-text-primary)' }} />
          <div className="bell-dot"></div>
        </div>
        
        <div className="user-profile">
          <User size={20} style={{ color: 'var(--color-background-surface)' }} />
        </div>
      </div>
    </nav>
  );
};

export default TopNav;
