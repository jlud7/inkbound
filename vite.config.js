import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Minimal Vite config: React JSX support, no extras needed for this MVP.
// base './' makes built asset URLs relative, so the same build works at the
// domain root (local dev/preview) and under a subpath (GitHub Pages /inkbound/).
export default defineConfig({
  base: './',
  plugins: [react()],
});
