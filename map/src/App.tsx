import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, ChevronRight, Code2, Compass, Download, Layers, LoaderCircle, Map, MapPin, Minus, MousePointer2, Navigation2, Palette, Pause, Play, Plus, RotateCcw, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { KathmanduMap } from './KathmanduMap';
import type { KathmanduMapHandle } from './KathmanduMap';
import metadata from './data/metadata.json';
import { THEMES } from './themes';
import { DEFAULT_LAYERS } from './types';
import { unproject } from './geometry';
import type { LayerName, MapColors, MapMetadata, MapPin as MapPinData, ThemeName } from './types';
import { colorsFor } from './renderer';

type Tab = 'design' | 'places' | 'export';
const layerNames: [LayerName, string][] = [['buildings', 'Building footprints'], ['roads', 'Main roads'], ['streets', 'Small streets & paths'], ['green', 'Parks & green spaces'], ['water', 'Rivers & ponds'], ['labels', 'Neighbourhood names'], ['landmarks', 'Landmark drawings']];
const meta = metadata as MapMetadata;

function ThemePreview({ theme }: { theme: ThemeName }) {
  const c = THEMES[theme].colors;
  return <svg viewBox="0 0 140 66" role="img" aria-label={`${THEMES[theme].name} style preview`}>
    <defs><pattern id={`thumb-${theme}`} width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill={c.background} /><path d="M-1,1L1,-1M0,4L4,0M3,5L5,3" stroke={c.building} strokeWidth="1.5" /></pattern></defs>
    <rect width="140" height="66" fill={c.background} />
    <path d="M0,0H35L50,15L29,35L0,24ZM102,0H140V32L122,25L104,14ZM60,43L75,35L93,66H53Z" fill={c.green} />
    <path d="M-5,59C21,18 49,53 65,22S102,34 146,5" fill="none" stroke={c.water} strokeWidth="5" />
    <path d="M39,0L24,66M76,0L92,66M0,36L140,24M0,58L140,46" fill="none" stroke={c.roadEdge} strokeWidth="6" />
    <path d="M39,0L24,66M76,0L92,66M0,36L140,24M0,58L140,46" fill="none" stroke={c.road} strokeWidth="4" />
    <path d="M44,4L62,4L65,17L40,23ZM40,28L66,23L70,30L38,35ZM41,44L69,37L72,47L39,52ZM99,32L122,28L124,36L102,42ZM5,40L21,36L19,49L3,53Z" fill={theme === 'print' ? `url(#thumb-${theme})` : c.building} />
    <circle cx="77" cy="31" r="4" fill={c.accent} stroke={c.background} strokeWidth="2" />
  </svg>;
}

export default function App() {
  const mapRef = useRef<KathmanduMapHandle>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('design'), [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [tab]);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const update = () => setIsMobile(media.matches);
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  const [theme, setTheme] = useState<ThemeName>('atlas'), [layers, setLayers] = useState({ ...DEFAULT_LAYERS });
  const [customColors, setCustomColors] = useState<Partial<MapColors>>({});
  const [pins, setPins] = useState<MapPinData[]>([]), [pinMode, setPinMode] = useState(false), [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [search, setSearch] = useState(''), [zoom, setZoom] = useState(1.16);
  const [route, setRoute] = useState(false), [playing, setPlaying] = useState(false);
  const [detailReady, setDetailReady] = useState(false), [baseReady, setBaseReady] = useState(false);
  const [exportArea, setExportArea] = useState<'view' | 'city'>('view');
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState('');
  const options = { theme, layers, colors: customColors }, palette = colorsFor(options);
  const chooseTheme = (next: ThemeName) => { setTheme(next); setCustomColors({}); };
  const selected = pins.find(p => p.id === selectedPin);
  const addPin = ({ lon, lat }: { lon: number; lat: number }) => {
    if (!pinMode) return;
    const id = crypto.randomUUID();
    setPins(p => [...p, { id, label: `My place ${p.length + 1}`, lon, lat }]);
    setSelectedPin(id); setPinMode(false); setTab('places'); setPanelOpen(true);
  };
  const goTo = (x: number, y: number) => { const p = unproject(x, y, meta); mapRef.current?.flyTo(p.lon, p.lat, 3); setPanelOpen(false); };
  const exportMap = async (format: 'svg' | 'png' | 'kit') => {
    setBusy(format); setNotice('');
    try {
      const exporting = await import('./export');
      if (format === 'kit') await exporting.exportComponentKit(options, pins, route);
      else {
        const data = mapRef.current?.getData(); if (!data) throw new Error('Wait for the base map to load, then try again.');
        if (layers.buildings && !detailReady) throw new Error('Building detail is still loading. Try again shortly, or turn off buildings.');
        const view = exportArea === 'city' ? { x: 0, y: 0, width: data.width, height: data.height } : mapRef.current!.getView();
        if (format === 'svg') {
          const svg = exporting.createSVG(data, options, pins, view, route);
          exporting.download(new Blob([svg], { type: 'image/svg+xml' }), 'kathmandu-map.svg');
        } else await exporting.exportPNG(data, options, pins, view, route);
      }
      setNotice(`${format === 'kit' ? 'Component kit' : format.toUpperCase()} downloaded. Make something good with it.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Export failed. Please try again.'); }
    finally { setBusy(null); }
  };

  return <div className="maker">
    <header className="maker-header">
      <a className="wordmark" href="/" aria-label="Maproom home"><span className="brand-mark"><Map size={19} strokeWidth={1.8} /></span>maproom<span className="wordmark-dot">.</span></a>
      <div className="header-project"><span className="header-divider" /><span>Kathmandu</span><span className="city-chip">City edition</span></div>
      <div className="header-actions"><span className="local-note"><span />Made in your browser</span><button className="primary-button header-export" onClick={() => { setTab('export'); setPanelOpen(true); }}><ArrowDownToLine size={15} />Export map</button></div>
    </header>

    <main className="maker-workspace">
      <button className="mobile-panel-toggle" onClick={() => setPanelOpen(o => !o)} aria-expanded={panelOpen} aria-controls="maker-panel"><SlidersHorizontal size={17} />{panelOpen ? 'Close editor' : 'Edit map'}</button>
      <aside id="maker-panel" inert={isMobile && !panelOpen} className={`maker-panel ${panelOpen ? 'maker-panel--open' : ''}`}>
        <div className="panel-intro"><h1>A city, made yours.</h1><p>Little streets. Familiar places.<br />Your own way to map Kathmandu.</p></div>
        <nav className="panel-tabs" aria-label="Map editor"><button aria-current={tab === 'design' ? 'page' : undefined} onClick={() => setTab('design')}><Palette size={15} />Design</button><button aria-current={tab === 'places' ? 'page' : undefined} onClick={() => setTab('places')}><MapPin size={15} />Places{pins.length > 0 && <span className="tab-count">{pins.length}</span>}</button><button aria-current={tab === 'export' ? 'page' : undefined} onClick={() => setTab('export')}><Download size={15} />Export</button></nav>
        <div className="panel-content" ref={contentRef}>
          {tab === 'design' && <>
            <section className="editor-section"><div className="section-heading"><h2>Choose a character</h2><span>4 styles</span></div><div className="theme-grid">{(Object.keys(THEMES) as ThemeName[]).map(name => <button className={`theme-choice ${theme === name ? 'is-selected' : ''}`} key={name} onClick={() => chooseTheme(name)} aria-pressed={theme === name}><div className="theme-thumbnail"><ThemePreview theme={name} />{theme === name && <span className="theme-check"><Check size={12} strokeWidth={2.5} /></span>}</div><strong>{THEMES[name].name}</strong><span>{THEMES[name].description}</span></button>)}</div></section>
            <section className="editor-section palette-section"><div className="section-heading"><h2>Make it your palette</h2>{Object.keys(customColors).length > 0 && <button className="text-button" onClick={() => setCustomColors({})}>Reset</button>}</div><div className="palette-row">{([['background', 'Paper'], ['building', 'Buildings'], ['green', 'Greenery'], ['water', 'Water'], ['accent', 'Accent']] as [keyof MapColors, string][]).map(([key, name]) => <label className="palette-color" key={key}><span className="color-well" style={{ background: palette[key] }}><input type="color" value={palette[key]} aria-label={`${name} colour`} onChange={e => setCustomColors(c => ({ ...c, [key]: e.target.value }))} /></span><span>{name}</span></label>)}</div></section>
            <section className="editor-section"><div className="section-heading"><h2>The little details</h2><Layers size={14} /></div><div className="layer-list">{layerNames.map(([key, name]) => <label className="layer-row" key={key}><span className={`layer-symbol layer-symbol--${key}`} /><span>{name}</span><input type="checkbox" checked={layers[key]} onChange={e => setLayers(l => ({ ...l, [key]: e.target.checked }))} /><span className="switch-track" aria-hidden="true" /></label>)}</div></section>
            <section className="route-section"><div><h2>Bring it to life</h2><p>Try a little journey through the city.</p></div><button className={`route-toggle ${route ? 'is-active' : ''}`} aria-pressed={route} onClick={() => { setRoute(r => !r); setPlaying(false); }}><Navigation2 size={17} />{route ? 'Hide demo route' : 'Preview a route'}<ChevronRight size={14} /></button></section>
          </>}
          {tab === 'places' && <>
            <section className="editor-section"><div className="section-heading"><h2>Put your places on the map</h2></div><p className="section-copy">A studio, a favourite café, your next stop. Drop a pin and give it a name.</p><button className={`outline-button wide-button ${pinMode ? 'is-active' : ''}`} onClick={() => { setPinMode(m => !m); setPanelOpen(false); }}><MapPin size={16} />{pinMode ? 'Cancel placing pin' : 'Drop a pin'}</button></section>
            {selected && <section className="editor-section pin-editor"><label htmlFor="pin-name">Place name</label><input id="pin-name" value={selected.label} maxLength={64} onChange={e => setPins(all => all.map(p => p.id === selected.id ? { ...p, label: e.target.value } : p))} /><div className="pin-meta"><span>{selected.lat.toFixed(5)}, {selected.lon.toFixed(5)}</span><label className="pin-color" title="Pin colour"><input type="color" aria-label="Pin colour" value={selected.color ?? palette.accent} onChange={e => setPins(all => all.map(p => p.id === selected.id ? { ...p, color: e.target.value } : p))} /></label></div></section>}
            {pins.length > 0 && <section className="editor-section"><div className="section-heading"><h2>Your places</h2><span>{pins.length}</span></div><ul className="pin-list">{pins.map(p => <li key={p.id}><button className="pin-list-place" onClick={() => { setSelectedPin(p.id); mapRef.current?.flyTo(p.lon, p.lat, 3); }}><MapPin size={15} style={{ color: p.color ?? palette.accent }} /><span>{p.label || 'Untitled place'}</span></button><button className="icon-button" aria-label={`Remove ${p.label || 'pin'}`} onClick={() => { setPins(all => all.filter(pin => pin.id !== p.id)); if (selectedPin === p.id) setSelectedPin(null); }}><Trash2 size={14} /></button></li>)}</ul></section>}
            <section className="editor-section"><div className="section-heading"><h2>Some familiar places</h2><Compass size={14} /></div><label className="search-field"><Search size={15} /><input aria-label="Search Kathmandu landmarks" placeholder="Find a landmark…" value={search} onChange={e => setSearch(e.target.value)} /></label><div className="landmark-list">{meta.landmarks.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).map(p => <button key={p.id} onClick={() => goTo(p.x, p.y)}><span>{p.name}</span><ArrowUpRight size={14} /></button>)}{meta.landmarks.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).length === 0 && <p className="empty-message">No landmarks found. Try another name, or drop your own pin.</p>}</div></section>
          </>}
          {tab === 'export' && <>
            <section className="editor-section"><div className="section-heading"><h2>Take Kathmandu with you</h2></div><p className="section-copy">For your next website, product, or little side project. Your design comes along.</p><div className="export-preview"><ThemePreview theme={theme} /><div><strong>{THEMES[theme].name}</strong><span>{Object.values(layers).filter(Boolean).length} layers · {pins.length} custom {pins.length === 1 ? 'place' : 'places'}</span></div></div></section>
            <section className="editor-section"><h2 className="export-heading">An image for anywhere</h2><fieldset className="export-area"><legend>Export area</legend><label><input type="radio" name="area" value="view" checked={exportArea === 'view'} onChange={() => setExportArea('view')} />Current view</label><label><input type="radio" name="area" value="city" checked={exportArea === 'city'} onChange={() => setExportArea('city')} />Whole city</label></fieldset><div className="image-export-buttons"><button className="outline-button" disabled={busy !== null || !baseReady || (layers.buildings && !detailReady)} onClick={() => exportMap('png')}>{busy === 'png' ? <LoaderCircle className="spinner" size={15} /> : <Download size={15} />}PNG</button><button className="outline-button" disabled={busy !== null || !baseReady || (layers.buildings && !detailReady)} onClick={() => exportMap('svg')}>{busy === 'svg' ? <LoaderCircle className="spinner" size={15} /> : <Download size={15} />}SVG</button></div><p className="helper-copy">PNG at 2400 px. SVG with editable layers.</p></section>
            <section className="editor-section"><h2 className="export-heading">A component for your project</h2><p className="section-copy">A ready-to-use React component, plus a plain Canvas renderer for other frameworks.</p><button className="primary-button wide-button" disabled={busy !== null} onClick={() => exportMap('kit')}>{busy === 'kit' ? <LoaderCircle className="spinner" size={16} /> : <Code2 size={16} />}{busy === 'kit' ? 'Packing your map…' : 'Download component kit'}</button><p className="helper-copy">Source code, map data, your settings, and a quick-start guide. No API key needed.</p><div className="kit-details"><div><Check size={13} />Canvas rendering, tiny overlays</div><div><Check size={13} />Buildings load on demand</div><div><Check size={13} />Pins, callbacks & animation hooks</div><div><Check size={13} />Works with React 18+ and Vite</div></div></section>
            <section className="license-note"><h2>Made to be shared</h2><p>Component code: MIT. Map data: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap / ODbL</a>. Attribution travels with every export.</p><p>Base map: 682 KB. Building detail: 2.3 MB, loaded separately.</p></section>
          </>}
        </div>
        <footer className="panel-footer"><span className="footer-dot" /><span>Real streets. Room for imagination.</span></footer>
      </aside>

      <section className="map-stage" aria-label="Your map preview">
        <KathmanduMap ref={mapRef} theme={theme} layers={layers} colors={customColors} pins={pins} pinMode={pinMode} showDemoRoute={route} animateRoute={playing}
          onMapClick={addPin} onPinClick={p => { setSelectedPin(p.id); setTab('places'); setPanelOpen(true); }}
          onViewChange={(_, nextZoom) => setZoom(nextZoom)} onReady={detail => { setBaseReady(true); setDetailReady(detail); }} />
        <div className="canvas-location"><MapPin size={13} /><span>Kathmandu, Nepal</span><span className="location-dot" />27.7172° N · 85.3240° E</div>
        <div className="north-marker" title="North is up"><span>N</span><Navigation2 size={23} fill="currentColor" strokeWidth={1.3} /></div>
        <div className="canvas-stamp" aria-hidden="true"><span>Kathmandu</span><small>Every alley has a story.</small></div>
        {pinMode && <div className="pin-prompt"><MousePointer2 size={15} />Click a place on the map<button className="icon-button" onClick={() => setPinMode(false)} aria-label="Cancel placing pin"><X size={15} /></button></div>}
        <div className={`route-player ${route ? '' : 'route-player--idle'}`}>
          {route && <><span className="demo-badge">Demo</span><span>Thamel <span className="route-arrow">→</span> Boudhanath</span></>}
          <button className="route-play" onClick={() => { setRoute(true); setPlaying(p => !p); setPanelOpen(false); }} aria-label={playing ? 'Pause route animation' : 'Play route animation'}>
            {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
            <span>{playing ? 'Pause' : route ? 'Play' : 'Play route demo'}</span>
          </button>
          {route && <button className="icon-button" onClick={() => { setRoute(false); setPlaying(false); }} aria-label="Close demo route"><X size={14} /></button>}
        </div>
        <div className="zoom-control"><button aria-label="Zoom in" title="Zoom in (+)" onClick={() => mapRef.current?.zoomIn()} disabled={zoom >= 12}><Plus size={18} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom out" title="Zoom out (-)" onClick={() => mapRef.current?.zoomOut()} disabled={zoom <= .75}><Minus size={18} /></button><span className="zoom-separator" /><button aria-label="Reset map view" title="Reset view (Home)" onClick={() => mapRef.current?.resetView()}><RotateCcw size={16} /></button></div>
        <div className="canvas-help"><MousePointer2 size={12} /><span>Drag to explore<span className="help-dot">·</span>Scroll to get closer</span></div>
      </section>
    </main>
    {notice && <div className="export-notice" role="status"><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss export message"><X size={16} /></button></div>}
  </div>;
}
