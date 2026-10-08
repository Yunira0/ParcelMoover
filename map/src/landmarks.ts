/** Small geometric landmark glyphs; shared by Canvas and SVG export. */
export const LANDMARK_PATHS: Record<string, string[]> = {
  stupa: ['M-16,5 Q-15,-9 0,-9 Q15,-9 16,5 Z', 'M-19,6 H19 V10 H-19 Z', 'M-5,-9 V-16 H5 V-9 Z', 'M-6,-16 L0,-31 L6,-16 Z', 'M0,-31 V-35'],
  temple: ['M-11,-5 H11 V9 H-11 Z', 'M-18,-5 L0,-15 L18,-5 Z', 'M-13,-17 L0,-25 L13,-17 Z', 'M-3,-17 V-13 H3 V-17', 'M0,-25 V-30'],
  palace: ['M-20,8 V-11 H20 V8 Z', 'M-22,-11 L-14,-20 L-6,-11 M-8,-11 L0,-22 L8,-11 M6,-11 L14,-20 L22,-11', 'M-3,8 V-2 H3 V8', 'M-14,-6 V1 M-9,-6 V1 M9,-6 V1 M14,-6 V1'],
  garden: ['M0,9 V-11', 'M0,-1 C-18,-2 -16,-19 -3,-11 Z', 'M0,-5 C2,-21 19,-21 13,-8 Z', 'M-9,10 H9'],
  tower: ['M-6,8 L-4,-24 H4 L6,8 Z', 'M-8,8 H8 V11 H-8 Z', 'M-6,-24 L0,-29 L6,-24 Z', 'M-4,-17 H4 M-4,-10 H4 M-5,-3 H5'],
  water: ['M-18,0 Q-12,-8 -6,0 T6,0 T18,0', 'M-18,9 Q-12,1 -6,9 T6,9 T18,9', 'M0,-9 V-23 M-8,-15 L0,-23 L8,-15'],
};
