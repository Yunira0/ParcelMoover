import type { MapData, MapFeature } from './types';
import baseUrl from './data/kathmandu-base.json.gz?url';
import buildingsUrl from './data/kathmandu-buildings.json.gz?url';
export { baseUrl, buildingsUrl };

function readGeometry<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./data.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ data?: T; error?: string }>) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.data as T);
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('Map worker could not start. Check your connection and content security policy.')); };
    worker.postMessage(url);
  });
}
const baseCache = new Map<string, Promise<MapData>>();
const buildingCache = new Map<string, Promise<MapFeature[]>>();
export function loadBase(url = baseUrl) {
  if (!baseCache.has(url)) baseCache.set(url, readGeometry<MapData>(url).then(data => ({ ...data, buildings: [] })).catch(error => { baseCache.delete(url); throw error; }));
  return baseCache.get(url)!;
}
export function loadBuildings(url = buildingsUrl) {
  if (!buildingCache.has(url)) buildingCache.set(url, readGeometry<MapFeature[]>(url).catch(error => { buildingCache.delete(url); throw error; }));
  return buildingCache.get(url)!;
}
