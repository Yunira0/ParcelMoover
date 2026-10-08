import type { MapColors, ThemeName } from './types';
export const THEMES: Record<ThemeName, { name: string; description: string; colors: MapColors }> = {
  atlas: { name: 'Everyday atlas', description: 'A city in fine detail', colors: {
    background: '#efece1', building: '#d1cbbd', buildingStroke: '#beb7a8', green: '#c0d09a', forest: '#9eBA80',
    water: '#90bfc1', road: '#fffdf5', roadEdge: '#c1b7a6', street: '#f9f6ee', ink: '#344337', muted: '#69745a',
    accent: '#dc5b3b', airport: '#e2ddcf',
  } },
  field: { name: 'Field guide', description: 'Bright, green & playful', colors: {
    background: '#e9edd7', building: '#d0d3c3', buildingStroke: '#b6bda8', green: '#b6cc6b', forest: '#789c4c',
    water: '#7ec4d6', road: '#fffef2', roadEdge: '#a8b894', street: '#faffeb', ink: '#284635', muted: '#526f44',
    accent: '#ec6538', airport: '#d7dcc9',
  } },
  print: { name: 'Letterpress', description: 'Coral ink on warm paper', colors: {
    background: '#f1eade', building: '#df806b', buildingStroke: '#d46550', green: '#d4d7c6', forest: '#b8c1aa',
    water: '#d0dbd7', road: '#f8f2e6', roadEdge: '#c9c0b2', street: '#f8f2e6', ink: '#443f37', muted: '#786e60',
    accent: '#c84c33', airport: '#e4dbcd',
  } },
  night: { name: 'After hours', description: 'A quieter kind of city', colors: {
    background: '#1c2a2a', building: '#344443', buildingStroke: '#40514e', green: '#334c3c', forest: '#284837',
    water: '#305860', road: '#789085', roadEdge: '#1e302e', street: '#485c53', ink: '#e5ead9', muted: '#acbba4',
    accent: '#f2aa76', airport: '#2c3e3b',
  } },
};
