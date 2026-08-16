import React, { useEffect, useRef, useState } from 'react';
import { FileImage, FileText, Upload, X } from 'lucide-react';
import './FileField.css';

type FileFieldProps = {
  label: string;
  hint: string;
} & (
  | {
      multiple?: false;
      file: File | null;
      onChange: (file: File | null) => void;
    }
  | {
      /** Take several files at once — a transfer can be photographed more than once. */
      multiple: true;
      files: File[];
      onChange: (files: File[]) => void;
    }
);

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

const isImageFile = (file: File) => file.type.startsWith('image/');

// Compact upload slot shared by anywhere a document is attached: the Make
// Payment flow's proof step, the statement detail page's after-the-fact
// "attach proof" affordance, and the billing screens.
const FileField: React.FC<FileFieldProps> = (props) => {
  const { label, hint } = props;
  const ref = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const picked: File[] = props.multiple ? props.files : props.file ? [props.file] : [];

  // Object URLs are a per-document allocation, not garbage collected with the
  // File — revoking on change keeps a long editing session from leaking them.
  const [previews, setPreviews] = useState<(string | null)[]>([]);
  useEffect(() => {
    const urls = picked.map((file) => (isImageFile(file) ? URL.createObjectURL(file) : null));
    setPreviews(urls);
    return () => {
      urls.forEach((url) => url && URL.revokeObjectURL(url));
    };
    // Identity of the File objects is what matters, not the array wrapper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join('|')]);

  const emit = (next: File[]) => {
    if (props.multiple) {
      props.onChange(next);
    } else {
      props.onChange(next[0] ?? null);
    }
  };

  const handleFiles = (fileList: FileList | null) => {
    const incoming = Array.from(fileList ?? []);
    if (incoming.length === 0) return;
    emit(props.multiple ? [...picked, ...incoming] : [incoming[0]!]);
  };

  const removeAt = (index: number) => emit(picked.filter((_, i) => i !== index));

  // With `multiple`, the slot keeps offering the drop zone below what's already
  // been picked, so adding a second picture is one click rather than a reset.
  const showDropZone = props.multiple || picked.length === 0;

  return (
    <div className="file-field">
      <span className="file-field-label">{label}</span>

      {picked.map((file, index) => (
        <div className="file-field-picked" key={`${file.name}-${file.lastModified}-${index}`}>
          {previews[index] ? (
            <img src={previews[index] as string} alt="" className="file-field-thumb" />
          ) : (
            <div className="file-field-thumb file-field-thumb-icon">
              <FileText size={18} />
            </div>
          )}
          <div className="file-field-picked-info">
            <span className="file-field-picked-name">{file.name}</span>
            <span className="file-field-picked-size">{(file.size / 1024).toFixed(0)} KB</span>
          </div>
          <button
            type="button"
            className="file-field-remove"
            onClick={() => removeAt(index)}
            aria-label={`Remove ${file.name}`}
          >
            <X size={14} />
          </button>
        </div>
      ))}

      {showDropZone && (
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
            <Upload size={13} />{' '}
            {props.multiple && picked.length > 0 ? 'Add another file' : 'Choose file'}{' '}
            <span className="file-field-drop-or">or drag it here</span>
          </span>
        </button>
      )}

      <input
        ref={ref}
        type="file"
        accept={ACCEPT}
        multiple={props.multiple}
        style={{ display: 'none' }}
        onChange={(event) => {
          handleFiles(event.target.files);
          // Reset so re-picking the same file still fires a change event.
          event.target.value = '';
        }}
      />
      <span className="file-field-hint">{hint}</span>
    </div>
  );
};

export default FileField;
