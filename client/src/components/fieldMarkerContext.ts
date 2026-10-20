import { createContext } from 'react';

/** Labels mark the fields people may skip with "(optional)"; required fields
 *  carry no marker. Wrap a filter bar or similar in `value="none"` to drop it. */
export type FieldMarkerMode = 'optional' | 'none';
export const FieldMarkerContext = createContext<FieldMarkerMode>('optional');
