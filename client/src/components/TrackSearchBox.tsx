import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import './TrackSearchBox.css';

interface TrackSearchBoxProps {
  /** 'hero' sits on a photo (light placeholder, dark backdrop); 'page' sits on a plain surface. */
  variant?: 'hero' | 'page';
  initialValue?: string;
  className?: string;
}

const TrackSearchBox: React.FC<TrackSearchBoxProps> = ({ variant = 'hero', initialValue = '', className }) => {
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);
  const navigate = useNavigate();

  const trimmed = value.trim();
  const showError = touched && trimmed.length === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) {
      setTouched(true);
      return;
    }
    navigate(`/track/${encodeURIComponent(trimmed.toUpperCase())}`);
  };

  return (
    <form
      className={`track-search track-search-${variant}${className ? ` ${className}` : ''}`}
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="track-search-field">
        <Search size={18} className="track-search-icon" aria-hidden="true" />
        <input
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Enter tracking ID, e.g. PM-260710-..."
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (touched) setTouched(false);
          }}
          aria-label="Parcel tracking ID"
          aria-invalid={showError}
        />
        <button type="submit" className="track-search-submit">
          Track
        </button>
      </div>
      {showError && <p className="track-search-error">Enter a tracking ID to continue.</p>}
    </form>
  );
};

export default TrackSearchBox;
