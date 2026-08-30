import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // src/data.js uses top-level await; the default esbuild target
    // (chrome87/es2020/etc.) rejects that. This app already assumes a
    // recent browser (OKLch CSS), so esnext is a safe target.
    target: 'esnext',
  },
});
