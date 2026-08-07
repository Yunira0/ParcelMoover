import React, { useRef, useState } from 'react';
import { FileImage, FileText, Upload, X } from 'lucide-react';
import './FileField.css';

interface FileFieldProps {
  label: string;
  hint: string;
  file: File | null;
  onChange: (file: File | null) => void;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

const isImageFile = (file: File) => file.type.startsWith('image/');

// Compact upload slot shared by anywhere a settlement document is attached:
// the Make Payment flow's proof step and the statement detail page's
// after-the-fact "attach proof" affordance.
const FileField: React.FC<FileFieldProps> = ({ label, hint, file, onChange }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const previewUrl = file && isImageFile(file) ? URL.createObjectURL(file) : null;

  const handleFiles = (files: FileList | null) => {
    const picked = files?.[0];
    if (picked) onChange(picked);
  };

  return (
    <div className="file-field">
      <span className="file-field-label">{label}</span>
      {file ? (
        <div className="file-field-picked">
          {previewUrl ? (
            <img src={previewUrl} alt="" className="file-field-thumb" />
          ) : (
            <div className="file-field-thumb file-field-thumb-icon">
              <FileText size={18} />
            </div>
          )}
          <div className="file-field-picked-info">
            <span className="file-field-picked-name">{file.name}</span>
            <span className="file-field-picked-size">{(file.size / 1024).toFixed(0)} KB</span>
          </div>
          <button type="button" className="file-field-remove" onClick={() => onChange(null)} aria-label={`Remove ${label}`}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`file-field-drop${dragOver ? ' file-field-drop-active' : ''}`}
          onClick={() => ref.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <FileImage size={18} className="file-field-drop-icon" />
          <span className="file-field-drop-text">
            <Upload size={13} /> Choose file <span className="file-field-drop-or">or drag it here</span>
          </span>
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={(event) => handleFiles(event.target.files)}
      />
      <span className="file-field-hint">{hint}</span>
    </div>
  );
};

export default FileField;
