import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site from /<repo>/, so the deploy workflow sets
  // BASE_PATH. Local dev and any root-hosted deploy use '/'.
  base: process.env.BASE_PATH || '/',
  server: { port: 5180, open: true },
  build: {
    outDir: 'dist',
    // The embed loader injects an <iframe> pointing at index.html, so a single
    // entry covers both the standalone site and the embedded widget.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
});
