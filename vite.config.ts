import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // Uploaded files are written by the server at runtime; a reload on
        // every upload is noise. (The two JSON/SQLite store files this used to
        // name went with the move to SQL Server.)
        ignored: ['**/uploads/**'],
      },
    },
  };
});
