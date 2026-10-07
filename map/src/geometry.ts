import type { MapMetadata, Point } from './types';
const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
/** Same Web Mercator projection used by the offline data compiler. */
export function project(lon: number, lat: number, meta: MapMetadata): Point {
  const scale = meta.width / ((meta.bounds.east - meta.bounds.west) * Math.PI / 180);
  return [(lon - meta.bounds.west) * Math.PI / 180 * scale, (mercator(meta.bounds.north) - mercator(lat)) * scale];
}
export function unproject(x: number, y: number, meta: MapMetadata) {
  const scale = meta.width / ((meta.bounds.east - meta.bounds.west) * Math.PI / 180);
  return { lon: meta.bounds.west + x / scale * 180 / Math.PI,
    lat: (2 * Math.atan(Math.exp(mercator(meta.bounds.north) - y / scale)) - Math.PI / 2) * 180 / Math.PI };
}
