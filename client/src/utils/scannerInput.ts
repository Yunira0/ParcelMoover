import type { ClipboardEvent, KeyboardEvent } from 'react';

// A handheld barcode scanner types each tracking id then sends Enter, with
// virtually no gap before the next scan's characters start arriving.
// Rewriting a single controlled-input string on every Enter (e.g. appending
// ", ") races the next scan's keystrokes against React's re-render: under
// fast automated typing the append can land after some of the next code's
// characters, silently corrupting both. Verified live: characters go missing
// mid-tracking-id and only a handful of scans survive.
//
// Committing the finished term into a separate list and resetting the visible
// buffer to '' sidesteps the race entirely - '' is a trivial, always-safe
// value to set, and every scan after the first types into a fresh, empty,
// perfectly normal controlled input with no external interference. Render
// the committed list as chips next to the input so scans are still visibly
// confirmed, without the input's own value ever being rewritten out-of-band.
export function commitScannedTerm(
  event: KeyboardEvent<HTMLInputElement>,
  setTerms: (updater: (prev: string[]) => string[]) => void,
  setBuffer: (value: string) => void,
) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const value = event.currentTarget.value.trim();
  if (!value) return;
  setTerms(prev => (prev.includes(value) ? prev : [...prev, value]));
  setBuffer('');
}

// Pasting a copied spreadsheet column comes in newline-separated (each row on
// its own line); a copied row range comes in tab-separated. Either way, a
// multi-value paste should behave like scanning each value in turn - split it
// into terms and commit them all at once instead of dumping raw multi-line
// text into a single-line search box. A single pasted value (no separators)
// is left alone so normal paste-then-edit behavior still works.
export function handleScannerPaste(
  event: ClipboardEvent<HTMLInputElement>,
  setTerms: (updater: (prev: string[]) => string[]) => void,
  setBuffer: (value: string) => void,
) {
  const text = event.clipboardData.getData('text');
  const tokens = text.split(/[\n\r\t,]+/).map(t => t.trim()).filter(Boolean);
  if (tokens.length <= 1) return;

  event.preventDefault();
  setTerms(prev => {
    const next = [...prev];
    for (const token of tokens) {
      if (!next.includes(token)) next.push(token);
    }
    return next;
  });
  setBuffer('');
}
