# Maproom — Kathmandu map maker

A standalone map maker in `map/`. Customise real Kathmandu streets and building footprints, place pins, preview a route, and export a reusable component or an image.

## Run

```sh
cd map
npm install
npm run dev
```

Open http://127.0.0.1:5180. The current checkout can reuse the already-installed client dependencies through the ignored `map/node_modules` link.

```sh
npm run check
npm run build
npm run kit:build
```

`build` creates the standalone maker in `dist/`. `kit:build` creates a separate ES-module component entry in `kit-dist/index.js`, its CSS and external data assets. React is an external peer dependency. Keep the generated `assets/` beside the JS and import the generated CSS in your host app. The maker's **Download component kit** exports TypeScript source, data, your chosen settings and pins, and an integration guide.

## Reuse in React

```tsx
import { KathmanduMap } from './map/src';

export function CityMap() {
  return <div style={{ height: 600 }}>
    <KathmanduMap
      theme="atlas"
      layers={{ buildings: true, landmarks: true }}
      pins={[{ id: 'studio', label: 'Our studio', lat: 27.7172, lon: 85.3240 }]}
      onMapClick={({ lat, lon }) => console.log(lat, lon)}
    />
  </div>;
}
```

The source uses Vite's asset URL handling and module-worker bundling. Copy the exported `src/` into a React 18+ TypeScript/Vite project, or use the compiled kit with its adjacent assets. Modern browsers with `Path2D`, `ResizeObserver`, module workers, and `DecompressionStream` are required. CSP must permit same-origin workers. There are no runtime mapping SDKs, API keys, tile servers, font requests, or telemetry. The maker fonts are self-hosted; the reusable map uses the host's standard sans-serif map labels.

The React ref exposes `zoomIn`, `zoomOut`, `resetView`, `flyTo(lon, lat, zoom)`, `getView`, `getData`, and `getCanvas`. `onPinClick`, `onViewChange`, and `onReady(detailLoaded)` support integration. Disable `interactive` for a static landing-page map. Pins retain longitude and latitude, independently of the viewport.

For other frameworks, `KathmanduRenderer` is a dependency-free Canvas renderer. Use `loadBase` and `loadBuildings`, construct the renderer with a canvas and the data, then call `draw(view, options, cssWidth, cssHeight)` after resizing or changing the camera. Your framework can supply its own gestures and controls. Call `dispose()` when removing it.

## Performance

- Canvas basemap, no DOM element per building or road.
- Lightweight SVG overlay only for interactive pins, route animation, and custom children.
- Base geometry: about **682 KiB** compressed; optional building detail: about **2.3 MiB** compressed.
- Geometry decompression and JSON parsing run in module workers.
- Building geometry is fetched only when enabled, separately from the base.
- Tile-sized footprint groups, viewport culling, cached `Path2D`, `requestAnimationFrame` draws, and a DPR cap of 2.
- Subpixel buildings and footpaths are omitted at small sizes.
- The reusable compiled JavaScript is about **9.5 kB gzip**, excluding React, CSS, and map data. The maker UI and export code are separate; source-export modules load only when needed.
- Canvas exposes `data-render-ms` and `data-cached-paths` for integration diagnostics. Timing measures drawing-command submission, not GPU completion or end-to-end frame time.

## Animation

Pass `showDemoRoute` and `animateRoute` to preview the included Thamel → Boudhanath route. Animation is opt-in and respects reduced-motion preferences. SVG children use the same projected world coordinates as `project(lon, lat, metadata)` and are suitable for additional vehicles, route drawing, or animated markers. The Canvas base is not repainted for route playback.

The demo follows a shortest path through the source road graph. It is a design demonstration, not current delivery guidance or a turn-by-turn routing service.

## Export

- PNG: 2400-pixel image drawn directly with Canvas, with pins and attribution.
- SVG: editable, named map layers generated on demand.
- Component kit: reusable React source, Canvas renderer, worker, gzip geometry, settings, pins, MIT code license, ODbL data notice, and quick-start guide.

Choose the current view or whole-city extent for image exports. All exports happen in the browser.

## Geographic source and refresh

The rectangle covers central Kathmandu and its city context, including Swayambhunath, Boudhanath, Pashupatinath and Tribhuvan airport. It is not clipped to an official municipal boundary. This is a static OpenStreetMap snapshot, not a complete survey or a live map. The attached references informed the styles; their geography was not reused.

The included snapshot contains **191,070 building footprints** and **15,010 road segments**. Bounds: south 27.684, west 85.277, north 27.755, east 85.381. Snapshot time and provenance are in `src/data/metadata.json`.

To refresh, submit `scripts/kathmandu.overpass` to an Overpass API server, save its JSON response, then run:

```sh
npm run data:build -- /path/to/overpass.json
```

The compiler validates that Overpass did not return a partial result, projects to Web Mercator, rounds to roughly 0.64 metres, aggregates geometry, preserves bounds for culling, and writes deterministic gzip assets. Footprints use relative coordinate deltas to reduce size while preserving the rounded geometry.

Map data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0. Keep visible attribution and the data license with distributed copies. Component source: MIT; see `LICENSE` and `DATA-LICENSE.md`. Fonts: DM Sans and Fraunces, SIL Open Font License.

This standalone work does not change vendor-facing application behaviour or API routes.
