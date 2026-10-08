import { KathmanduRenderer, colorsFor, roadWidth } from './renderer';
import { LANDMARK_PATHS } from './landmarks';
import { project } from './geometry';
import { baseUrl, buildingsUrl } from './data';
import metadata from './data/metadata.json';
import type { MapData, MapOptions, MapPin, MapView } from './types';

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createSVG(data: MapData, options: MapOptions, pins: MapPin[], view: MapView, route: boolean, width = 1800) {
  const c = colorsFor(options), l = options.layers, height = Math.round(width * view.height / view.width), unit = view.width / width;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${view.x} ${view.y} ${view.width} ${view.height}">`,
    `<title>Kathmandu city</title><desc>Map data © OpenStreetMap contributors. ODbL-1.0. ${escape(data.source.url)}</desc>`,
    `<defs><clipPath id="city"><rect width="${data.width}" height="${data.height}"/></clipPath><pattern id="print-hatch" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="${c.background}"/><path d="M-3 3L3-3M0 6L6 0M3 9L9 3" stroke="${c.building}" stroke-width="2.5"/></pattern></defs>`,
    `<rect x="${view.x}" y="${view.y}" width="${view.width}" height="${view.height}" fill="${c.background}"/><g clip-path="url(#city)" stroke-linecap="round" stroke-linejoin="round">`];
  const group = (name: string, features: { id: string; d: string }[], attributes: string) => {
    out.push(`<g id="layer-${name}" ${attributes}>`);
    for (const f of features) out.push(`<path id="${name}-${escape(f.id)}" d="${f.d}"/>`);
    out.push('</g>');
  };
  if (l.green) {
    group('parks', data.green.filter(f => f.kind === 'park'), `fill="${c.green}" fill-rule="evenodd"`);
    group('forest', data.green.filter(f => f.kind === 'forest'), `fill="${c.forest}" fill-rule="evenodd"`);
  }
  group('airport', data.airport.filter(f => f.area), `fill="${c.airport}"`);
  if (l.water) {
    group('water-areas', data.water.filter(f => f.area), `fill="${c.water}"`);
    group('rivers', data.water.filter(f => !f.area && f.kind === 'river'), `fill="none" stroke="${c.water}" stroke-width="8"`);
    group('streams', data.water.filter(f => !f.area && f.kind !== 'river'), `fill="none" stroke="${c.water}" stroke-width="3"`);
  }
  if (l.buildings) group('buildings', data.buildings, `fill="${options.theme === 'print' ? 'url(#print-hatch)' : c.building}" fill-rule="evenodd"`);
  if (l.streets) group('streets', data.minorRoads, `fill="none" stroke="${c.street}" stroke-width="1.6"`);
  if (l.roads) {
    for (const edge of [true, false]) {
      out.push(`<g id="layer-road-${edge ? 'edges' : 'surfaces'}" fill="none" stroke="${edge ? c.roadEdge : c.road}">`);
      for (const f of data.roads) out.push(`<path id="road-${edge ? 'edge-' : ''}${escape(f.id)}" d="${f.d}" stroke-width="${roadWidth(f.kind) + (edge ? 1.6 : 0)}"/>`);
      out.push('</g>');
    }
  }
  out.push('</g>');
  if (l.labels) {
    out.push(`<g id="layer-labels" font-family="sans-serif" text-anchor="middle" font-size="${11 * unit}" font-weight="600" fill="${c.ink}" stroke="${c.background}" stroke-width="${3 * unit}" paint-order="stroke">`);
    for (const p of data.neighborhoods) out.push(`<text x="${p.x}" y="${p.y}">${escape(p.name.toUpperCase())}</text>`);
    out.push('</g>');
  }
  if (l.landmarks) {
    out.push('<g id="layer-landmarks">');
    for (const p of data.landmarks) {
      out.push(`<g id="${p.id}" transform="translate(${p.x} ${p.y}) scale(${unit})" stroke-linejoin="round"><g transform="scale(.68)" fill="${c.background}" stroke="${c.accent}" stroke-width="2.3">`);
      for (const d of LANDMARK_PATHS[p.kind ?? 'temple'] ?? LANDMARK_PATHS.temple) out.push(`<path d="${d}"/>`);
      out.push(`</g><text y="22" font-family="sans-serif" font-size="11" text-anchor="middle" font-weight="600" fill="${c.ink}" stroke="${c.background}" stroke-width="3" paint-order="stroke">${escape(p.name)}</text></g>`);
    }
    out.push('</g>');
  }
  if (route && data.demoRoute) out.push(`<g id="layer-routes" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${data.demoRoute.d}" stroke="${c.background}" stroke-width="${6 * unit}"/><path id="${data.demoRoute.id}" d="${data.demoRoute.d}" stroke="${c.accent}" stroke-width="${3 * unit}"/></g>`);
  out.push('<g id="layer-pins">');
  for (const p of pins) {
    const [x, y] = project(p.lon, p.lat, data);
    out.push(`<g id="pin-${escape(p.id)}" transform="translate(${x} ${y}) scale(${unit})"><path d="M0,0C-5,-7-11,-12-11,-19A11,11 0 1,1 11,-19C11,-12 5,-7 0,0Z" fill="${p.color ?? c.accent}" stroke="${c.background}" stroke-width="2.5"/><circle cy="-19" r="3.2" fill="${c.background}"/><text y="17" font-family="sans-serif" font-size="11" font-weight="600" text-anchor="middle" fill="${c.ink}" stroke="${c.background}" stroke-width="3" paint-order="stroke">${escape(p.label)}</text></g>`);
  }
  out.push(`</g><a href="${data.source.url}"><text x="${view.x + view.width - 12 * unit}" y="${view.y + view.height - 12 * unit}" font-family="sans-serif" font-size="${10 * unit}" fill="${c.ink}" text-anchor="end" stroke="${c.background}" stroke-width="${3 * unit}" paint-order="stroke">© OpenStreetMap contributors</text></a></svg>`);
  return out.join('');
}

export async function exportPNG(data: MapData, options: MapOptions, pins: MapPin[], view: MapView, route: boolean, width = 2400) {
  // Rasterise directly from the cached geometry rather than parsing a multi-MB
  // SVG image. This also shares label collision handling with the live map.
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const canvas = document.createElement('canvas'), cssWidth = width / 2, cssHeight = cssWidth * view.height / view.width;
  const renderer = new KathmanduRenderer(canvas, data), scale = cssWidth / view.width, c = colorsFor(options);
  try {
    renderer.draw(view, options, cssWidth, cssHeight, 2);
    const context = canvas.getContext('2d'); if (!context) throw new Error('Your browser cannot export a PNG.');
    if (route && data.demoRoute) {
      context.save(); context.setTransform(scale * 2, 0, 0, scale * 2, -view.x * scale * 2, -view.y * scale * 2);
      context.lineCap = 'round'; context.lineJoin = 'round';
      const path = new Path2D(data.demoRoute.d);
      context.strokeStyle = c.background; context.lineWidth = 6 / scale; context.stroke(path);
      context.strokeStyle = c.accent; context.lineWidth = 3 / scale; context.stroke(path);
      context.restore();
    }
    context.setTransform(2, 0, 0, 2, 0, 0);
    for (const pin of pins) {
      const [px, py] = project(pin.lon, pin.lat, data), x = (px - view.x) * scale, y = (py - view.y) * scale;
      context.save(); context.translate(x, y);
      const path = new Path2D('M0,0C-5,-7-11,-12-11,-19A11,11 0 1,1 11,-19C11,-12 5,-7 0,0Z');
      context.fillStyle = pin.color ?? c.accent; context.strokeStyle = c.background; context.lineWidth = 2.5;
      context.fill(path); context.stroke(path); context.beginPath(); context.arc(0, -19, 3.2, 0, Math.PI * 2); context.fillStyle = c.background; context.fill();
      context.font = '600 11px sans-serif'; context.textAlign = 'center'; context.lineWidth = 3;
      context.strokeText(pin.label, 0, 17); context.fillStyle = c.ink; context.fillText(pin.label, 0, 17); context.restore();
    }
    context.font = '10px sans-serif'; context.textAlign = 'right'; context.fillStyle = c.ink;
    context.strokeStyle = c.background; context.lineWidth = 4;
    context.strokeText('© OpenStreetMap contributors', cssWidth - 12, cssHeight - 12);
    context.fillText('© OpenStreetMap contributors', cssWidth - 12, cssHeight - 12);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG export failed.')), 'image/png'));
    download(blob, 'kathmandu-map.png');
  } finally { renderer.dispose(); canvas.width = canvas.height = 0; }
}

/** Minimal ZIP writer (store mode). Geometry is already gzip-compressed. */
function zip(files: { name: string; bytes: Uint8Array }[]) {
  const chunks: Uint8Array[] = [], directory: Uint8Array[] = [];
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; table[n] = c; }
  let offset = 0;
  const header = (size: number) => { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; };
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    let crc = 0xffffffff; for (const b of f.bytes) crc = table[(crc ^ b) & 255] ^ crc >>> 8; crc = (crc ^ 0xffffffff) >>> 0;
    const local = header(30 + name.length), v = local.view;
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true); v.setUint16(12, 0x21, true);
    v.setUint32(14, crc, true); v.setUint32(18, f.bytes.length, true); v.setUint32(22, f.bytes.length, true); v.setUint16(26, name.length, true); local.bytes.set(name, 30);
    chunks.push(local.bytes, f.bytes);
    const central = header(46 + name.length), c = central.view;
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, f.bytes.length, true); c.setUint32(24, f.bytes.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.bytes.set(name, 46);
    directory.push(central.bytes); offset += local.bytes.length + f.bytes.length;
  }
  const end = header(22), e = end.view, directorySize = directory.reduce((sum, c) => sum + c.length, 0);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end.bytes] as BlobPart[], { type: 'application/zip' });
}

export async function exportComponentKit(options: MapOptions, pins: MapPin[], route: boolean) {
  const sources = import.meta.glob(['./KathmanduMap.tsx', './kathmandu-map.css', './types.ts', './themes.ts', './geometry.ts', './landmarks.ts', './renderer.ts', './data.ts', './data.worker.ts', './index.ts', './vite-env.d.ts'], { query: '?raw', import: 'default' });
  const files: { name: string; bytes: Uint8Array }[] = [];
  const addText = (name: string, content: string) => files.push({ name, bytes: new TextEncoder().encode(content) });
  for (const [path, load] of Object.entries(sources)) addText(`src/${path.slice(2)}`, await load() as string);
  const geometry = await Promise.all([baseUrl, buildingsUrl].map(async (url, i) => {
    const response = await fetch(url); if (!response.ok) throw new Error('Map assets could not download. Try again.');
    let bytes = new Uint8Array(await response.arrayBuffer());
    // Dev servers and CDNs can decode a .gz response transparently. The kit
    // should retain its small compressed assets regardless of host headers.
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return { name: `src/data/kathmandu-${i ? 'buildings' : 'base'}.json.gz`, bytes };
  }));
  files.push(...geometry);
  addText('src/data/metadata.json', JSON.stringify(metadata));
  addText('src/map-config.json', JSON.stringify({ ...options, pins, showDemoRoute: route }, null, 2));
  addText('src/YourMap.tsx', `import { KathmanduMap } from './KathmanduMap';\nimport config from './map-config.json';\nimport type { KathmanduMapProps } from './KathmanduMap';\n\nexport default function YourMap() {\n  return <div style={{ width: '100%', height: 600 }}>\n    <KathmanduMap {...(config as KathmanduMapProps)} />\n  </div>;\n}\n`);
  addText('package.json', JSON.stringify({ name: 'kathmandu-map-kit', version: '0.1.0', private: true, type: 'module', peerDependencies: { react: '>=18', 'react-dom': '>=18' }, devDependencies: { typescript: '>=5.0', vite: '>=5.0' } }, null, 2));
  addText('LICENSE', 'The component source code in this kit is licensed under the MIT License.\nCopyright (c) 2026 Maproom contributors\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n\nThis license does not cover map data. See DATA-LICENSE.md.\n');
  addText('DATA-LICENSE.md', `# Map data\n\n© OpenStreetMap contributors. Licensed under the Open Database License 1.0 (ODbL).\nhttps://www.openstreetmap.org/copyright\nhttps://opendatacommons.org/licenses/odbl/1-0/\n\nSnapshot: ${metadata.source.snapshot}\nThe bundled .json.gz files are projected, aggregated extracts of OpenStreetMap data. Retain the attribution and comply with ODbL when redistributing the data. Component code and cartographic styling are separate from that data.\n`);
  addText('README.md', `# Your Kathmandu map\n\nCopy src/ into a React 18+ TypeScript app using Vite, then import YourMap from './YourMap'. Your style, layer choices and geographic pins are in src/map-config.json. No API key or mapping SDK is needed. Give the parent a fixed or responsive height.\n\nThe base is Canvas. A tiny SVG overlay provides accessible pins and optional route animation. Compressed data is decoded in module workers. Buildings load only when enabled. Modern browsers with Canvas Path2D, module workers and DecompressionStream are required. Keep the src/data assets and data.worker.ts alongside the component so Vite resolves them. Your CSP must permit same-origin workers.\n\nFor non-React projects, import KathmanduRenderer from src/renderer.ts and loadBase/loadBuildings from src/data.ts. Construct the renderer with a canvas and loaded data, then call draw(view, options, cssWidth, cssHeight) when your viewport changes. Manage pointer/resize events in your framework. dispose() releases the path cache.\n\nPublic exports: KathmanduMap, KathmanduRenderer, project, unproject, THEMES, DEFAULT_LAYERS, loadBase, loadBuildings. The React ref exposes zoomIn(), zoomOut(), resetView(), flyTo(lon, lat, zoom), getView(), getData(), getCanvas(). Pass onMapClick/onPinClick for integrations. Optional SVG children use projected world coordinates; use project(lon, lat, metadata). Animations are opt-in; reduced motion is respected.\n\nThis is a Kathmandu city snapshot, not a live map or turn-by-turn routing service. The demonstration route is road-derived and must not be treated as current delivery guidance.\n\nCode: MIT. Data: ODbL-1.0, © OpenStreetMap contributors. Preserve DATA-LICENSE.md and on-map attribution.\n`);
  download(zip(files), 'kathmandu-map-kit.zip');
}
