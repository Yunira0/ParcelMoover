import React from 'react';
import { Link } from 'react-router-dom';
import { PackageX, ArrowLeft } from 'lucide-react';
import './NotFound.css';

const NotFound: React.FC = () => {
  return (
    <div className="not-found">
      <PackageX size={48} strokeWidth={1.5} />
      <h1>404</h1>
      <p>This page doesn't exist or may have been moved.</p>
      <Link to="/" className="btn btn-primary">
        <ArrowLeft size={16} /> Back to Home
      </Link>
    </div>
  );
};

export default NotFound;
