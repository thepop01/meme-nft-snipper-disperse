import { defineConfig } from 'vitest/config';
import { transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';

// The UI contract suite (SmartWalletsView.test.js) is intentionally a .test.js
// file (the vitest include only matches *.test.js) but contains JSX. Vite's
// oxc pipeline derives the parser lang from the file extension, so .js files
// are never parsed as JSX. This pre-plugin compiles JSX out of __tests__
// .test.js files before vite:oxc sees them; plain-JS suites fall through.
const jsxInJsTests = {
  name: 'jsx-in-js-tests',
  enforce: 'pre',
  async transform(code, id) {
    if (!/[\\/]__tests__[\\/][^\\/]*\.test\.js(\?.*)?$/.test(id)) return null;
    try {
      const out = await transformWithOxc(code, id, {
        lang: 'jsx',
        jsx: { runtime: 'automatic' },
        sourcemap: true,
      });
      return { code: out.code, map: out.map ?? null };
    } catch {
      return null;
    }
  },
};

export default defineConfig({
  plugins: [jsxInJsTests, react()],
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.js'],
  },
});
