import React, { useState } from 'react';
import { FileText, Paperclip, Plus, Trash2 } from 'lucide-react';
import Button from '../../components/Button';
import FileField from '../../components/FileField';
import {
  attachCarrierSettlementFiles,
  carrierSettlementFileUrl,
  deleteCarrierSettlementFile,
  type CarrierSettlementDetail,
} from '../../services/carrierCod.service';
import '../../components/AttachSettlementDocumentsCard.css';
import '../SettlementDetailPage.css';

type Document = CarrierSettlementDetail['documents'][number];

/** Attach form - the same card the vendor statement uses for receipts. */
const AttachCard: React.FC<{ settlementId: string; label: string; onDone: () => void; onCancel: () => void }> = ({
  settlementId,
  label,
  onDone,
  onCancel,
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await attachCarrierSettlementFiles(settlementId, files);
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to attach file');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="asd-card">
      <div className="asd-card-header">
        <Paperclip size={16} className="asd-card-icon" />
        <div>
          <h3>Attach {label}</h3>
          <p>Add the carrier's settlement sheet for this statement. You can pick more than one file.</p>
        </div>
      </div>
      <div className="asd-files asd-files-single">
        <FileField multiple label="Settlement file" hint="JPG, PNG, WebP or PDF · max 5 MB each · add up to 5" files={files} onChange={setFiles} />
      </div>
      {error && <div className="asd-error" role="alert">{error}</div>}
      <div className="asd-actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="button" variant="primary" onClick={save} disabled={files.length === 0 || saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </section>
  );
};

const FileCard: React.FC<{ settlementId: string; label: string; document: Document; onChanged: () => void }> = ({
  settlementId,
  label,
  document,
  onChanged,
}) => {
  const [removing, setRemoving] = useState(false);
  const href = carrierSettlementFileUrl(settlementId, document.id);

  const remove = async () => {
    setRemoving(true);
    try {
      await deleteCarrierSettlementFile(settlementId, document.id);
      onChanged();
    } catch {
      setRemoving(false);
    }
  };

  return (
    <div className="settlement-doc-view">
      {document.fileName && <span className="settlement-doc-caption">{document.fileName}</span>}
      {document.isPdf ? (
        <div className="settlement-doc-frame settlement-doc-pdf-wrap">
          <iframe className="settlement-doc-pdf-frame" src={href} title={label} />
        </div>
      ) : (
        <a className="settlement-doc-frame" href={href} target="_blank" rel="noreferrer">
          <img src={href} alt={label} loading="lazy" />
        </a>
      )}
      {document.isPdf && (
        <a className="settlement-doc-open-link" href={href} target="_blank" rel="noreferrer">
          <FileText size={14} />
          Open in new tab
        </a>
      )}
      <div className="settlement-doc-actions">
        <button type="button" className="settlement-attach-proof-btn settlement-attach-proof-btn--danger" onClick={remove} disabled={removing}>
          <Trash2 size={14} />
          {removing ? 'Removing...' : 'Remove'}
        </button>
      </div>
    </div>
  );
};

/** The statement's "Settlement file" tab: the carrier's own sheet(s), like a vendor statement's receipt tab. */
const CarrierSettlementFiles: React.FC<{ settlementId: string; documents: Document[]; onChanged: () => void }> = ({
  settlementId,
  documents,
  onChanged,
}) => {
  const [attaching, setAttaching] = useState(false);
  const label = 'settlement file';

  if (attaching) {
    return (
      <AttachCard
        settlementId={settlementId}
        label={label}
        onDone={() => { setAttaching(false); onChanged(); }}
        onCancel={() => setAttaching(false)}
      />
    );
  }

  if (documents.length === 0) {
    return (
      <div className="settlement-doc-empty">
        <FileText size={22} className="settlement-doc-empty-icon" />
        <p>No {label} attached yet.</p>
        <button type="button" className="settlement-attach-proof-btn" onClick={() => setAttaching(true)}>
          <Paperclip size={14} />
          Attach {label}
        </button>
      </div>
    );
  }

  return (
    <div className="settlement-doc-gallery">
      {documents.map((doc) => (
        <FileCard key={doc.id} settlementId={settlementId} label={label} document={doc} onChanged={onChanged} />
      ))}
      <button type="button" className="settlement-attach-proof-btn settlement-doc-add" onClick={() => setAttaching(true)}>
        <Plus size={14} />
        Add another {label}
      </button>
    </div>
  );
};

export default CarrierSettlementFiles;
