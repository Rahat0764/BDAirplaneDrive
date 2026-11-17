import { defineConfig } from 'vite';
import ts from 'typescript';

const isAndroidStorage = process.platform === 'android';

// Pure Node TypeScript transform fallback for Android /storage/emulated/0 (where Go/esbuild cannot readdir /storage)
function androidTsPlugin() {
  return {
    name: 'android-ts-transpile',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.ts')) return null;
      const out = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          sourceMap: false,
        },
      });
      return { code: out.outputText, map: null };
    },
  };
}

export default defineConfig({
  base: '/',
  esbuild: isAndroidStorage ? false : undefined,
  plugins: isAndroidStorage ? [androidTsPlugin()] : [],
  build: {
    outDir: 'dist',
    target: 'es2020',
    minify: isAndroidStorage ? false : 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
