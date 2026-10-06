import type { MapColors, MapData, MapFeature, MapOptions, MapView } from './types';
import { THEMES } from './themes';
import { LANDMARK_PATHS } from './landmarks';

export const roadWidth = (kind?: string) => ({ motorway: 7, trunk: 6.5, primary: 5.3, secondary: 4.5, tertiary: 3.4 }[kind ?? ''] ?? 2);
export const colorsFor = (options: MapOptions): MapColors => ({ ...THEMES[options.theme].colors, ...options.colors });
const intersects = (f: MapFeature, v: MapView) => f.bounds[2] >= v.x && f.bounds[0] <= v.x + v.width && f.bounds[3] >= v.y && f.bounds[1] <= v.y + v.height;

/** Framework-independent, dependency-free Canvas renderer. No DOM node per feature. */
export class KathmanduRenderer {
  private cache = new Map<string, Path2D>();
  private hatch?: CanvasPattern | null;
  private hatchColor = '';
  private hatchBackground = '';
  constructor(public canvas: HTMLCanvasElement, public data: MapData) {}

  private geometry(feature: MapFeature) {
    let value = this.cache.get(feature.id);
    if (!value) {
      value = new Path2D(feature.d);
      this.cache.set(feature.id, value);
    }
    return value;
  }

  draw(view: MapView, options: MapOptions, width: number, height: number, pixelRatio = Math.min(window.devicePixelRatio || 1, 2)) {
    const started = performance.now();
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx || !width || !height) return;
    const ratio = pixelRatio;
    const rw = Math.round(width * ratio), rh = Math.round(height * ratio);
    if (this.canvas.width !== rw || this.canvas.height !== rh) {
      this.canvas.width = rw; this.canvas.height = rh;
    }
    const c = colorsFor(options), layers = options.layers;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = c.background; ctx.fillRect(0, 0, width, height);
    const scale = width / view.width;
    ctx.setTransform(scale * ratio, 0, 0, scale * ratio, -view.x * scale * ratio, -view.y * scale * ratio);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, this.data.width, this.data.height); ctx.clip();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const paint = (items: MapFeature[], fill?: string | CanvasPattern, stroke?: string, lineWidth = 1) => {
      if (fill) ctx.fillStyle = fill;
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; }
      for (const f of items) {
        if (!intersects(f, view)) continue;
        const p = this.geometry(f);
        if (fill) ctx.fill(p, 'evenodd');
        if (stroke) ctx.stroke(p);
      }
    };
    if (layers.green) {
      paint(this.data.green.filter(f => f.kind === 'park'), c.green);
      paint(this.data.green.filter(f => f.kind === 'forest'), c.forest);
    }
    paint(this.data.airport.filter(f => f.area), c.airport);
    if (layers.water) {
      paint(this.data.water.filter(f => f.area), c.water);
      for (const f of this.data.water.filter(f => !f.area)) paint([f], undefined, c.water, f.kind === 'river' ? 8 : 3);
    }
    // Hide subpixel footprints on tiny embeds; they add cost but no readable detail.
    if (layers.buildings && scale > 0.24) {
      let fill: string | CanvasPattern = c.building;
      if (options.theme === 'print') {
        if (this.hatchColor !== c.building || this.hatchBackground !== c.background || !this.hatch) {
          const tile = document.createElement('canvas'); tile.width = tile.height = 6;
          const t = tile.getContext('2d')!;
          t.fillStyle = c.background; t.fillRect(0, 0, 6, 6); t.strokeStyle = c.building; t.lineWidth = 2.5;
          t.beginPath(); t.moveTo(-3, 3); t.lineTo(3, -3); t.moveTo(0, 6); t.lineTo(6, 0); t.moveTo(3, 9); t.lineTo(9, 3); t.stroke();
          this.hatch = ctx.createPattern(tile, 'repeat'); this.hatchColor = c.building; this.hatchBackground = c.background;
        }
        fill = this.hatch ?? c.building;
      }
      paint(this.data.buildings, fill, scale > 1.1 ? c.buildingStroke : undefined, 0.35);
    }
    if (layers.streets) {
      paint(this.data.minorRoads.filter(f => f.kind === 'local'), undefined, c.street, 1.6);
      if (scale > 0.7) {
        ctx.setLineDash([2, 2]);
        paint(this.data.minorRoads.filter(f => f.kind === 'path'), undefined, c.muted, 0.6);
        ctx.setLineDash([]);
      }
    }
    if (layers.roads) {
      for (const f of this.data.roads) paint([f], undefined, c.roadEdge, roadWidth(f.kind) + 1.6);
      for (const f of this.data.roads) paint([f], undefined, c.road, roadWidth(f.kind));
    }
    for (const f of this.data.airport.filter(f => !f.area)) paint([f], undefined, c.muted, f.kind === 'runway' ? 12 : 3);
    ctx.restore();

    // Labels and glyphs stay screen-sized and crisp at every zoom.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const boxes: [number, number, number, number][] = [];
    const screen = (x: number, y: number) => [(x - view.x) * scale, (y - view.y) * scale];
    const label = (text: string, x: number, y: number, font: string, color: string, padding = 7) => {
      ctx.font = font;
      const tw = ctx.measureText(text).width;
      const box: [number, number, number, number] = [x - tw / 2 - padding, y - 12, x + tw / 2 + padding, y + 6];
      if (x < 20 || x > width - 20 || y < 25 || y > height - 25 || boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return false;
      boxes.push(box); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.strokeStyle = c.background; ctx.lineWidth = 3.5; ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y); return true;
    };
    if (layers.landmarks) {
      for (const p of this.data.landmarks) {
        const [x, y] = screen(p.x, p.y);
        if (x < -30 || y < -30 || x > width + 30 || y > height + 30) continue;
        const drawn = label(p.name, x, y + 22, '600 11px sans-serif', c.ink);
        if (!drawn) continue;
        ctx.save(); ctx.translate(x, y); ctx.scale(0.68, 0.68);
        ctx.fillStyle = c.background; ctx.strokeStyle = c.accent; ctx.lineWidth = 2.3;
        const paths = LANDMARK_PATHS[p.kind ?? 'temple'] ?? LANDMARK_PATHS.temple;
        for (const d of paths) { const path = new Path2D(d); ctx.fill(path); ctx.stroke(path); }
        ctx.restore();
      }
    }
    if (layers.labels) {
      for (const p of this.data.neighborhoods) {
        const [x, y] = screen(p.x, p.y);
        label(p.name.toUpperCase(), x, y, '600 10px sans-serif', c.ink, 15);
      }
      if (scale > 1.05) {
        for (const p of this.data.streetLabels) {
          const coords = [...p.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)];
          const point = coords[Math.floor(coords.length / 2)];
          if (!point) continue;
          const [x, y] = screen(Number(point[1]), Number(point[2]));
          label(p.name, x, y, '10px sans-serif', c.muted);
        }
      }
    }
    // DOM diagnostics are available to consuming projects without a debug UI.
    this.canvas.dataset.renderMs = (performance.now() - started).toFixed(2);
    this.canvas.dataset.cachedPaths = String(this.cache.size);
  }
  dispose() { this.cache.clear(); this.hatch = undefined; }
  get cachedPaths() { return this.cache.size; }
}
