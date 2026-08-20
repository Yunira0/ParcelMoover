import React, { useEffect, useState } from 'react';
import { FileText, ExternalLink } from 'lucide-react';
import Button from './Button';
import { getUserDocuments, type ManagedUserDocument } from '../services/users.service';
import { toDocumentUrl } from '../utils/documentUrl';
import './Modal.css';
import './UserDocumentsModal.css';

type ManagedUserType = 'admin' | 'vendor' | 'rider';

interface UserDocumentsModalProps {
  isOpen: boolean;
  userType: ManagedUserType;
  target: { id: string; name: string } | null;
  onClose: () => void;
}

const UserDocumentsModal: React.FC<UserDocumentsModalProps> = ({
  isOpen,
  userType,
  target,
  onClose,
}) => {
  const [documents, setDocuments] = useState<ManagedUserDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Callers build `target` inline, so a new object arrives on every parent
  // render; keying the fetch on the id keeps it to one request per account.
  const targetId = target?.id ?? null;

  useEffect(() => {
    if (!isOpen || !targetId) return;

    let cancelled = false;
    setLoading(true);
    setError('');
    setDocuments([]);

    getUserDocuments(userType, targetId)
      .then((res) => {
        if (cancelled) return;
        if (res?.success && res.data) setDocuments(res.data.documents);
        else setError(res?.message || 'Failed to load documents.');
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.response?.data?.message || 'Failed to load documents.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, userType, targetId]);

  if (!isOpen || !target) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content user-documents-modal">
        <div className="modal-header">
          <h2>Registration Documents</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose} type="button">
            &times;
          </Button>
        </div>

        <p className="modal-desc">Documents submitted by {target.name} at registration.</p>

        {loading ? (
          <p className="user-documents-state">Loading documents...</p>
        ) : error ? (
          <p className="error-text">{error}</p>
        ) : documents.length === 0 ? (
          <p className="user-documents-state">No documents were uploaded for this account.</p>
        ) : (
          <ul className="user-documents-list">
            {documents.map((doc) => (
              <li key={doc.key} className="user-documents-item">
                <span className="user-documents-label">
                  <FileText size={15} />
                  {doc.label}
                </span>
                <a
                  href={toDocumentUrl(doc.path)}
                  target="_blank"
                  rel="noreferrer"
                  className="user-documents-link"
                >
                  View <ExternalLink size={12} />
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-footer">
          <Button variant="outline" onClick={onClose} type="button">Close</Button>
        </div>
      </div>
    </div>
  );
};

export default UserDocumentsModal;
