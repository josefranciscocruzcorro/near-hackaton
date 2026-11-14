import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Packages only the lazy wallet chunk uses: NEAR Wallet Selector, its wallets and their
 * dependencies (React is shared with the app and deliberately not listed).
 */
const WALLET_PACKAGES = [
  // Scopes match every package inside them.
  '@near-wallet-selector', '@near-js', '@meteorwallet', '@here-wallet', '@noble', '@scure',
  'near-api-js', 'near-abi', 'borsh', 'bs58', 'base-x', 'bn\\.js', 'js-sha256', 'rxjs', 'events', 'buffer', 'ieee754', 'base64-js',
  'zod', 'nanoid', 'query-string', 'decode-uri-component', 'split-on-first', 'filter-obj', 'strict-uri-encode', 'qrcode', 'pngjs',
  'dijkstrajs', 'copy-to-clipboard', 'toggle-selection', 'is-my-json-valid', 'is-my-ip-valid', 'generate-function',
  'generate-object-property', 'is-property', 'jsonpointer', 'xtend', 'sha1', 'crypt', 'charenc', 'uuid4', 'lru_map', 'depd',
  'mustache', 'tslib', 'exponential-backoff', 'secp256k1', 'elliptic', 'hash\\.js', 'hmac-drbg', 'brorand', 'inherits',
  'minimalistic-assert', 'minimalistic-crypto-utils', 'safe-buffer', 'randombytes', 'text-encoding-utf-8', 'http-errors',
  'statuses', 'setprototypeof', 'toidentifier', 'node-fetch', 'whatwg-url', 'tr46', 'webidl-conversions', 'node-gyp-build',
];
const WALLET_DEPS = new RegExp(`node_modules[\\\\/](${WALLET_PACKAGES.join('|')})[\\\\/]`);
const WALLET_SOURCES = /[\\/]src[\\/]wallet[\\/]|^__vite-browser-external/;

/**
 * A chunk made only of wallet code (our src/wallet + the packages above; `\0` ids are bundler
 * helpers). It gets the `wallet-` prefix: fetched from the network when the owner signs, never
 * precached by the service worker, so installing the PWA stays light.
 */
function isWalletChunk(moduleIds: readonly string[]): boolean {
  const real = moduleIds.filter((id) => !id.startsWith('\0'));
  return real.length > 0 && real.every((id) => WALLET_DEPS.test(id) || WALLET_SOURCES.test(id));
}

// Override with API_PROXY_TARGET=http://host:port when the API runs elsewhere.
const BACKEND = process.env.API_PROXY_TARGET ?? 'http://localhost:5080';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
  resolve: {
    // The HOT/HERE wallet SDK (lazy wallet chunk) requires Node's `crypto` for `randomBytes` only.
    alias: [{ find: /^crypto$/, replacement: fileURLToPath(new URL('./src/wallet/crypto-shim.ts', import.meta.url)) }],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'theme-init.js'],
      manifest: {
        id: '/',
        name: 'Tesorero',
        short_name: 'Tesorero',
        description:
          'AI treasury agent for small businesses: guarded supplier payments settled cross-chain with NEAR Intents.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#FAFAF9',
        theme_color: '#0E9F6E',
        categories: ['finance', 'business', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        globIgnores: ['**/node_modules/**', '**/assets/wallet-*.js'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health/, /^\/hangfire/, /^\/media\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/') || url.pathname === '/health',
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  // The proxy keeps the browser's Host header: the API resolves the tenant from it (ADR-0006).
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: false },
      '/health': { target: BACKEND, changeOrigin: false },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: false },
      '/health': { target: BACKEND, changeOrigin: false },
    },
  },
  build: {
    target: 'es2023',
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Wallet SDKs load only when the owner signs (src/wallet/selector.ts, dynamic imports).
        // Meteor's validation library (zod, no dependencies) gets its own chunk so no file
        // exceeds the size budget.
        codeSplitting: {
          groups: [{ name: 'zod', test: /node_modules[\\/]zod[\\/]/ }],
        },
        chunkFileNames: (chunk) => (isWalletChunk(chunk.moduleIds) ? 'assets/wallet-[name]-[hash].js' : 'assets/[name]-[hash].js'),
      },
      onLog(level, log, handler) {
        // Two Node-only branches inside the lazy wallet chunk that never run in the browser:
        // js-sha256 `eval("require('crypto')")` (only when `process.versions.node` exists) and
        // generate-function's `require('util')` (only used to compile ABI validators, which the
        // owner actions never do). Everything else is reported as usual.
        if (log.code === 'EVAL' && log.id?.includes('js-sha256')) return;
        if (log.message.includes('"util" has been externalized') && log.message.includes('generate-function')) return;
        handler(level, log);
      },
    },
  },
});
