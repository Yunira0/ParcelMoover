export const designTokens = {
  color: {
    icon: {
      placeholder: 'var(--color-icon-placeholder)',
      base: 'var(--color-icon-base)',
      primary: 'var(--color-icon-primary)',
      caption: 'var(--color-icon-caption)',
      default: 'var(--color-icon-default)',
    },
    text: {
      placeholder: 'var(--color-text-placeholder)',
      base: 'var(--color-text-base)',
      primary: 'var(--color-text-primary)',
      caption: 'var(--color-text-caption)',
      default: 'var(--color-text-default)',
    },
    background: {
      surface: 'var(--color-background-surface)',
      primaryDefault: 'var(--color-background-primary-default)',
      elevated: 'var(--color-background-elevated)',
      successDefault: 'var(--color-background-success-default)',
      warningDefault: 'var(--color-background-warning-default)',
      canvas: 'var(--color-background-canvas)',
    },
    border: {
      default: 'var(--color-border-default)',
      primary: 'var(--color-border-primary)',
    },
  },
  typography: {
    fontFamilyDefault: 'var(--typography-font-family-default)',
    mediumTextSm: 'var(--typography-medium-text-sm)',
  },
  fontWeight: {
    regular: 'var(--font-weight-regular)',
    medium: 'var(--font-weight-medium)',
    semiBold: 'var(--font-weight-semi-bold)',
    bold: 'var(--font-weight-bold)',
  },
  fontSize: {
    xxs: 'var(--font-size-xxs)',
    sm: 'var(--font-size-sm)',
    md: 'var(--font-size-md)',
    lg: 'var(--font-size-lg)',
    xl: 'var(--font-size-xl)',
    '2xl': 'var(--font-size-2xl)',
  },
  lineHeight: {
    xxs: 'var(--line-height-xxs)',
    sm: 'var(--line-height-sm)',
    md: 'var(--line-height-md)',
    lg: 'var(--line-height-lg)',
    '2xl': 'var(--line-height-2xl)',
  },
  space: {
    '0.5': 'var(--space-0-5)',
    '1': 'var(--space-1)',
    '1.5': 'var(--space-1-5)',
    '2': 'var(--space-2)',
    '3': 'var(--space-3)',
    '4': 'var(--space-4)',
    '5': 'var(--space-5)',
    '6': 'var(--space-6)',
    '16': 'var(--space-16)',
  },
  radius: {
    default: 'var(--border-radius-default)',
    modal: 'var(--border-radius-modal)',
    full: 'var(--border-radius-full)',
  },
  opacity: {
    '20': 'var(--opacity-20)',
    '50': 'var(--opacity-50)',
    '60': 'var(--opacity-60)',
    '75': 'var(--opacity-75)',
  },
  size: {
    minSm: 'var(--width-min-sm)',
    '9': 'var(--size-9)',
  },
} as const

export type DesignTokens = typeof designTokens
