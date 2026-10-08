# Kathmandu map component

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
People building websites and applications can customise and export maps for their own projects. ParcelMoover staff will also reuse them in internal tools and landing pages.

## Product Purpose
A detailed map component maker for Kathmandu city, with customisation and reusable component exports, not only SVG output.

## Capabilities and Constraints
The user confirmed Kathmandu city only, reuse by other projects, and performance and low weight as first priorities. Keep this work in the root `map/` folder. The existing application uses React and TypeScript. Use Canvas for the detailed basemap, separate geometry from code, and preserve geographic coordinates and overlay hooks for later animation.

## Brand Commitments
The supplied map image establishes a detailed cartographic direction: dense footprints, clear street hierarchy, green land cover, and small geographic labels.

## Evidence on Hand
The attached raster is a visual reference, not geographic source data for Kathmandu. Actual geometry comes from an attributed OpenStreetMap snapshot. No live operational data was supplied; any route preview must be labelled as a demo.

## Open Decisions
The component's eventual internal-tool and landing-page integrations will happen separately.
