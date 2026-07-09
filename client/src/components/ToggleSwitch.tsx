import React from 'react';
import './ToggleSwitch.css';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name describing what the switch controls. */
  ariaLabel: string;
}

// Small on/off switch for boolean row-level settings (e.g. account active state).
const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, onChange, disabled = false, ariaLabel }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    className={`toggle-switch${checked ? ' toggle-switch-on' : ''}`}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  >
    <span className="toggle-switch-knob" />
  </button>
);

export default ToggleSwitch;
