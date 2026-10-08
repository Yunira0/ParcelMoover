# Kathmandu map maker

The user supplied the visual authority: detailed footprint cartography, a bright park guide, coral print blocks, and a warm illustrated city map. The component supports these as coherent themes on one real geographic dataset. The reference-pinned world overrides the concept-seed assignment; the roll was degraded and provided no challengers.

Use a pale paper surface and ink typography for the maker shell. The map takes most of the screen. A narrow left panel owns style, layers, landmarks, and pin editing. Map controls float against the lower-right canvas edge. Use ParcelMoover's orange only for selected controls and routes; never invent live deliveries or operating statistics.

Atlas is the initial detailed green map. Field guide increases colour and landmark symbols. Letterpress uses coral hatched footprints and warm monochrome land. Night is a quiet dark alternative for reuse. All themes preserve geometry and the street hierarchy.

Keep animation opt-in. Preview movement on a real road-derived demonstration route, with a static alternative under reduced-motion preferences. Layer IDs, theme tokens, projected coordinates, stable source IDs, and declarative overlays are the extension seams for future animation. The detailed base is Canvas, with no DOM node per building. Geometry decoding happens in workers, buildings load separately, viewport culling precedes cached Path2D drawing, and DPR is capped at 2. SVG is generated on demand for export.
