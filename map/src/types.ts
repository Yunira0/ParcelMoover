export type ThemeName = 'atlas' | 'field' | 'print' | 'night';
export type LayerName = 'buildings' | 'roads' | 'streets' | 'green' | 'water' | 'labels' | 'landmarks';
export type MapLayers = Record<LayerName, boolean>;
export type Point = [number, number];
export interface MapView { x: number; y: number; width: number; height: number }
export interface MapPin { id: string; label: string; lat: number; lon: number; color?: string }
export interface MapColors {
  background: string; building: string; buildingStroke: string; green: string; forest: string;
  water: string; road: string; roadEdge: string; street: string; ink: string; muted: string;
  accent: string; airport: string;
}
export interface MapFeature { id: string; d: string; bounds: [number, number, number, number]; kind?: string; name?: string; area?: boolean }
export interface MapPlace { id: string; name: string; x: number; y: number; kind?: string }
export interface MapRoute { id: string; name: string; d: string; points: Point[]; start: Point; end: Point }
export interface MapMetadata {
  width: number; height: number;
  bounds: { south: number; west: number; north: number; east: number };
  counts: { buildings: number; roadSegments: number };
  source: { attribution: string; license: string; url: string; snapshot: string; generated: string };
  landmarks: MapPlace[]; demoRoute: MapRoute | null;
}
export interface MapData extends MapMetadata {
  buildings: MapFeature[]; roads: MapFeature[]; minorRoads: MapFeature[];
  green: MapFeature[]; water: MapFeature[]; airport: MapFeature[];
  neighborhoods: MapPlace[];
  streetLabels: { id: string; name: string; d: string; length: number }[];
}
export interface MapOptions {
  theme: ThemeName; layers: MapLayers; colors?: Partial<MapColors>;
}
export const DEFAULT_LAYERS: MapLayers = {
  buildings: true, roads: true, streets: true, green: true, water: true, labels: true, landmarks: true,
};
