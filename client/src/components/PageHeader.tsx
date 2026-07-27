import React from 'react';
import { ArrowLeft } from 'lucide-react';
import Button from './Button';
import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  subtitle: string;
  /** When provided, a back-button icon is rendered before the title. */
  onBack?: () => void;
  actionLabel?: string;
  actionIcon?: React.ReactNode;
  onAction?: () => void;
  actionTitle?: string;
  actionDisabled?: boolean;
  /** Extra action content (e.g. a per-module ticket button) rendered alongside the primary action. */
  children?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  onBack,
  actionLabel,
  actionIcon,
  onAction,
  actionTitle,
  actionDisabled,
  children,
}) => (
  <div className="page-header">
    <div className="page-header-info">
      {onBack && (
        <button type="button" className="page-header-back" onClick={onBack} aria-label="Go back" style={{ background: '#fff', color: '#000', border: '1px solid #d1d5db', padding: 0 }}>
          <ArrowLeft size={18} />
        </button>
      )}
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
    {(actionLabel || children) && (
      <div className="page-header-actions">
        {children}
        {actionLabel && (
          <Button
            variant="primary"
            onClick={onAction}
            title={actionTitle}
            disabled={actionDisabled}
          >
            {actionLabel}
            {actionIcon}
          </Button>
        )}
      </div>
    )}
  </div>
);

export default PageHeader;
