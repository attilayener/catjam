import { defineConfig } from 'vite';

// Electron paketleme dizinini dosya izleyicisinden dışla:
// chokidar bu klasörü izlerse open handle tutar ve electron-builder
// "EPERM: rename win-unpacked.tmp" hatasıyla kesilir.
export default defineConfig({
  server: {
    watch: {
      ignored: ['**/release/**'],
    },
  },
});
