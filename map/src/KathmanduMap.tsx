import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode, WheelEvent } from 'react';
import metadata from './data/metadata.json';
import { loadBase, loadBuildings } from './data';
import { KathmanduRenderer, colorsFor } from './renderer';
import { project, unproject } from './geometry';
import { DEFAULT_LAYERS } from './types';
import type { MapData, MapLayers, MapMetadata, MapOptions, MapPin, MapView, Point, ThemeName, MapColors } from './types';
import './kathmandu-map.css';

const meta = metadata as MapMetadata;
const MIN_ZOOM = 0.75, MAX_ZOOM = 12;
export interface KathmanduMapProps {
  theme?: ThemeName; layers?: Partial<MapLayers>; colors?: Partial<MapColors>;
  pins?: MapPin[]; showDemoRoute?: boolean; animateRoute?: boolean;
  interactive?: boolean; pinMode?: boolean; className?: string; style?: CSSProperties;
  /** Optional alternate snapshot URLs, for self-hosting the exported component. */
  baseDataUrl?: string; buildingDataUrl?: string;
  onMapClick?: (point: { lon: number; lat: number }) => void;
  onPinClick?: (pin: MapPin) => void;
  onViewChange?: (view: MapView, zoom: number) => void;
  onReady?: (detailLoaded: boolean) => void;
  /** SVG children use the same projected world coordinates as project(). */
  children?: ReactNode;
}
export interface KathmanduMapHandle {
  zoomIn(): void; zoomOut(): void; resetView(): void;
  flyTo(lon: number, lat: number, zoom?: number): void;
  getView(): MapView; getData(): MapData | null; getCanvas(): HTMLCanvasElement | null;
}

/** Canvas base + a tiny SVG overlay. No map SDK, API key, tile server or per-building DOM. */
export const KathmanduMap = forwardRef<KathmanduMapHandle, KathmanduMapProps>(function KathmanduMap({
  theme = 'atlas', layers, colors, pins = [], showDemoRoute = false, animateRoute = false,
  interactive = true, pinMode = false, className = '', style, baseDataUrl, buildingDataUrl,
  onMapClick, onPinClick, onViewChange, onReady, children,
}, ref) {
  const rootRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<KathmanduRenderer | null>(null), frame = useRef(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState({ cx: meta.width / 2, cy: meta.height * 0.57, zoom: 1.16 });
  const [status, setStatus] = useState<'loading' | 'base' | 'ready' | 'error' | 'detail-error'>('loading');
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const latestReady = useRef(onReady); latestReady.current = onReady;
  const options: MapOptions = { theme, colors, layers: { ...DEFAULT_LAYERS, ...layers } };
  const latestOptions = useRef(options); latestOptions.current = options;
  const latestSize = useRef(size); latestSize.current = size;
  // Cover narrow embeds as well as wide canvases, keeping the initial map
  // useful on phones instead of surrounding a tiny city with empty paper.
  const fitWidth = size.height ? Math.min(meta.width, meta.height * size.width / size.height) : meta.width;
  const vw = fitWidth / camera.zoom;
  const view: MapView = { x: camera.cx - vw / 2, y: camera.cy - vw * size.height / (size.width || 1) / 2,
    width: vw, height: vw * size.height / (size.width || 1) };
  const latestView = useRef(view); latestView.current = view;
  const latestCamera = useRef(camera); latestCamera.current = camera;
  const colorsUsed = colorsFor(options), uid = useId().replace(/:/g, '');
  const wantsBuildings = options.layers.buildings;
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; camera: typeof camera; distance: number; midpoint: Point; moved: boolean } | null>(null);

  const scheduleDraw = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const s = latestSize.current;
      renderer.current?.draw(latestView.current, latestOptions.current, s.width, s.height);
    });
  }, []);

  useEffect(() => {
    const node = rootRef.current!;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    loadBase(baseDataUrl).then(data => {
      if (!active || !canvasRef.current) return;
      renderer.current = new KathmanduRenderer(canvasRef.current, { ...data });
      setStatus('base'); latestReady.current?.(false); scheduleDraw();
    }).catch(err => { if (active) { setError(err.message); setStatus('error'); } });
    return () => { active = false; renderer.current?.dispose(); renderer.current = null; cancelAnimationFrame(frame.current); };
  }, [baseDataUrl, retry, scheduleDraw]);

  // Heavy detail is requested only when the consumer enables buildings.
  useEffect(() => {
    if (!wantsBuildings || status !== 'base') return;
    let active = true;
    loadBuildings(buildingDataUrl).then(buildings => {
      if (!active || !renderer.current) return;
      renderer.current.data.buildings = buildings;
      setStatus('ready'); latestReady.current?.(true); scheduleDraw();
    }).catch(err => { if (active) { setError(err.message); setStatus('detail-error'); } });
    return () => { active = false; };
  }, [buildingDataUrl, wantsBuildings, status, scheduleDraw]);

  useEffect(() => { scheduleDraw(); onViewChange?.(view, camera.zoom); },
    // Primitive dependencies keep incidental parent renders from repainting the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [size.width, size.height, camera.cx, camera.cy, camera.zoom, theme, JSON.stringify(layers), JSON.stringify(colors), scheduleDraw, status]);

  const setZoom = (zoom: number, anchor?: Point) => {
    const old = latestCamera.current, v = latestView.current, s = latestSize.current;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    if (!anchor || !s.width || !s.height) { setCamera({ ...old, zoom: next }); return; }
    const worldX = v.x + anchor[0] / s.width * v.width, worldY = v.y + anchor[1] / s.height * v.height;
    const nextWidth = v.width * old.zoom / next, nextHeight = v.height * old.zoom / next;
    setCamera({ zoom: next, cx: worldX - (anchor[0] / s.width - 0.5) * nextWidth,
      cy: worldY - (anchor[1] / s.height - 0.5) * nextHeight });
  };
  const reset = () => setCamera({ cx: meta.width / 2, cy: meta.height * 0.57, zoom: 1.16 });
  useImperativeHandle(ref, () => ({
    zoomIn: () => setZoom(latestCamera.current.zoom * 1.4), zoomOut: () => setZoom(latestCamera.current.zoom / 1.4),
    resetView: reset, flyTo: (lon, lat, zoom = 3) => {
      const [cx, cy] = project(lon, lat, meta); setCamera({ cx, cy, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) });
    },
    getView: () => latestView.current, getData: () => renderer.current?.data ?? null, getCanvas: () => canvasRef.current,
  }));

  const localPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = rootRef.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top];
  };
  const begin = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive || e.button > 0 || (e.target as HTMLElement).closest('button,a')) return;
    e.currentTarget.focus({ preventScroll: true }); e.currentTarget.setPointerCapture(e.pointerId);
    const pt = localPoint(e); pointers.current.set(e.pointerId, pt);
    const pts = [...pointers.current.values()];
    const midpoint: Point = pts.length > 1 ? [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2] : pt;
    gesture.current = { start: pt, camera: latestCamera.current, midpoint,
      distance: pts.length > 1 ? Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]) : 0, moved: pts.length > 1 };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current; if (!g || !pointers.current.has(e.pointerId)) return;
    const pt = localPoint(e); pointers.current.set(e.pointerId, pt);
    const pts = [...pointers.current.values()], scale = latestView.current.width / (size.width || 1);
    if (pts.length > 1 && g.distance) {
      g.moved = true;
      const distance = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, g.camera.zoom * distance / g.distance));
      const midpoint: Point = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
      const oldWidth = fitWidth / g.camera.zoom, newWidth = fitWidth / zoom;
      const oldHeight = oldWidth * size.height / size.width, newHeight = newWidth * size.height / size.width;
      setCamera({ zoom, cx: g.camera.cx + (g.midpoint[0] / size.width - .5) * oldWidth - (midpoint[0] / size.width - .5) * newWidth,
        cy: g.camera.cy + (g.midpoint[1] / size.height - .5) * oldHeight - (midpoint[1] / size.height - .5) * newHeight });
    } else {
      const dx = pt[0] - g.start[0], dy = pt[1] - g.start[1];
      if (Math.hypot(dx, dy) > 5) g.moved = true;
      if (g.moved) setCamera({ ...g.camera, cx: g.camera.cx - dx * scale, cy: g.camera.cy - dy * scale });
    }
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (g && !g.moved && e.type !== 'pointercancel') {
      const pt = localPoint(e), v = latestView.current;
      const world = unproject(v.x + pt[0] / size.width * v.width, v.y + pt[1] / size.height * v.height, meta);
      if (world.lon >= meta.bounds.west && world.lon <= meta.bounds.east && world.lat >= meta.bounds.south && world.lat <= meta.bounds.north) onMapClick?.(world);
    }
    pointers.current.delete(e.pointerId);
    // Restart the remaining finger after a pinch, avoiding a camera jump.
    const remaining = [...pointers.current.values()][0];
    gesture.current = remaining ? { start: remaining, camera: latestCamera.current, midpoint: remaining, distance: 0, moved: true } : null;
  };
  const wheel = (e: WheelEvent) => {
    if (!interactive) return;
    // The map is a dedicated interaction surface; the maker's panel scrolls separately.
    setZoom(latestCamera.current.zoom * Math.exp(-e.deltaY * .0015), localPoint(e));
  };
  useEffect(() => {
    const node = rootRef.current!;
    const prevent = (e: globalThis.WheelEvent) => { if (interactive) e.preventDefault(); };
    node.addEventListener('wheel', prevent, { passive: false });
    return () => node.removeEventListener('wheel', prevent);
  }, [interactive]);
  const keyboard = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || !interactive) return;
    const step = latestView.current.width * .08;
    const shifts: Record<string, Point> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (shifts[e.key]) { e.preventDefault(); const [dx, dy] = shifts[e.key]; setCamera(c => ({ ...c, cx: c.cx + dx, cy: c.cy + dy })); }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(camera.zoom * 1.4); }
    if (e.key === '-') { e.preventDefault(); setZoom(camera.zoom / 1.4); }
    if (e.key === 'Home') { e.preventDefault(); reset(); }
  };
  const scale = size.width / view.width;
  const route = meta.demoRoute;
  const meterPerUnit = (meta.bounds.east - meta.bounds.west) * 111320 * Math.cos(27.72 * Math.PI / 180) / meta.width;
  const meter = 500 * scale / meterPerUnit > 130 ? 200 : 500;

  return <div ref={rootRef} className={`ktm-map ${pinMode ? 'ktm-map--pin' : ''} ${interactive ? '' : 'ktm-map--static'} ${className}`}
    style={{ ...style, background: colorsUsed.background, '--ktm-ink': colorsUsed.ink, '--ktm-paper': colorsUsed.background } as CSSProperties}
    tabIndex={interactive ? 0 : undefined} role="region" aria-label={interactive ? 'Interactive map of Kathmandu city. Arrow keys pan; plus and minus zoom; Home resets.' : 'Map of Kathmandu city.'}
    onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onWheel={wheel} onKeyDown={keyboard}>
    <canvas ref={canvasRef} className="ktm-map__canvas" aria-hidden="true" />
    {size.width > 0 && <svg className="ktm-map__overlays" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} aria-label="Map routes and pins">
      {showDemoRoute && route && <g data-layer="routes" strokeLinejoin="round" strokeLinecap="round">
        <path d={route.d} fill="none" stroke={colorsUsed.background} strokeWidth={6 / scale} />
        <path id={`${uid}-route`} d={route.d} fill="none" stroke={colorsUsed.accent} strokeWidth={3 / scale} />
        {[route.start, route.end].map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={5 / scale} fill={colorsUsed.background} stroke={colorsUsed.accent} strokeWidth={2 / scale} />)}
        <circle className={`ktm-map__courier ${animateRoute ? 'ktm-map__courier--moving' : ''}`} r={6 / scale} fill={colorsUsed.accent} stroke={colorsUsed.background} strokeWidth={2 / scale} cx={animateRoute ? 0 : route.start[0]} cy={animateRoute ? 0 : route.start[1]}>
          {animateRoute && <animateMotion dur="16s" repeatCount="indefinite" path={route.d} />}
        </circle>
      </g>}
      <g data-layer="pins">{pins.map(pin => {
        const [x, y] = project(pin.lon, pin.lat, meta);
        return <g key={pin.id} transform={`translate(${x} ${y}) scale(${1 / scale})`} className="ktm-map__pin" role="button" tabIndex={0}
          aria-label={pin.label || 'Map pin'} onPointerDown={e => e.stopPropagation()} onClick={() => onPinClick?.(pin)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPinClick?.(pin); } }}>
          <path d="M0,0 C-5,-7 -11,-12 -11,-19 A11,11 0 1,1 11,-19 C11,-12 5,-7 0,0Z" fill={pin.color ?? colorsUsed.accent} stroke={colorsUsed.background} strokeWidth="2.5" />
          <circle cy="-19" r="3.2" fill={colorsUsed.background} />
          <text y="17" textAnchor="middle" fill={colorsUsed.ink} stroke={colorsUsed.background} strokeWidth="3" paintOrder="stroke" fontFamily="sans-serif" fontSize="11" fontWeight="600">{pin.label}</text>
        </g>;
      })}</g>
      {children}
    </svg>}
    {status === 'loading' && <div className="ktm-map__notice" role="status">Drawing Kathmandu…</div>}
    {status === 'base' && wantsBuildings && <div className="ktm-map__detail" role="status">Adding the little details…</div>}
    {(status === 'error' || status === 'detail-error') && <div className="ktm-map__notice" role="alert"><span>{status === 'detail-error' ? 'Building detail could not load. ' : 'The map could not load. '}{error}</span><button onClick={() => { setStatus('base'); setRetry(n => n + 1); }}>Try again</button></div>}
    <div className="ktm-map__scale" aria-label={`Scale: ${meter} metres`}><span style={{ width: meter / meterPerUnit * scale }} /><small>{meter} m</small></div>
    <a className="ktm-map__credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
  </div>;
});
