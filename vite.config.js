import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Minimal Vite config: React JSX support, no extras needed for this MVP.
export default defineConfig({
  plugins: [react()],
});
