import React from 'react';
import { FileText, ExternalLink } from 'lucide-react';
import './DocLink.css';

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/api\/?$/, '');

const DocLink: React.FC<{ path: string | null | undefined; label: string }> = ({ path, label }) => {
  if (!path) return <span className="doc-link-missing">—</span>;
  const relative = path.replace(/\\/g, '/').replace(/^.*?(uploads\/)/, '$1');
  return (
    <a
      href={`${API_BASE}/${relative}`}
      target="_blank"
      rel="noreferrer"
      className="doc-link"
    >
      <FileText size={14} /> {label} <ExternalLink size={12} />
    </a>
  );
};

export default DocLink;
