import React from 'react';
import Button from './Button';
import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  subtitle: string;
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
  actionLabel,
  actionIcon,
  onAction,
  actionTitle,
  actionDisabled,
  children,
}) => (
  <div className="page-header">
    <div className="page-header-info">
      <h1>{title}</h1>
      <p>{subtitle}</p>
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
