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
}

const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  actionLabel,
  actionIcon,
  onAction,
  actionTitle,
  actionDisabled,
}) => (
  <div className="page-header">
    <div className="page-header-info">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
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
);

export default PageHeader;
