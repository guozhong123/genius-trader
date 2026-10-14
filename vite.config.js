import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'full-screen': resolve(__dirname, 'full-screen.html'),
        popup: resolve(__dirname, 'popup.html'),
      },
    },
  },
});
