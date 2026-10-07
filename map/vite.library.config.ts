import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'kit-dist', assetsInlineLimit: 0,
    rolldownOptions: {
      input: 'src/index.ts', external: ['react', 'react-dom', 'react/jsx-runtime'],
      preserveEntrySignatures: 'strict', output: { format: 'es', entryFileNames: 'index.js' },
    },
  },
});
