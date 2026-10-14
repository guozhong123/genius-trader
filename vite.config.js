import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  // 扩展用相对路径；GitHub Pages 用 /genius-trader/
  base: process.env.VITE_BASE || './',
  plugins: [tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        'full-screen': resolve(__dirname, 'full-screen.html'),
        popup: resolve(__dirname, 'popup.html'),
      },
    },
  },
});
