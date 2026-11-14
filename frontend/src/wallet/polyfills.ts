// Node globals some wallet SDK dependencies expect. The wallet chunk imports this first and loads
// the wallet modules afterwards (dynamic import), so these exist before any of them runs:
// - `Buffer`: MyNearWallet and HOT/HERE encode transactions with it;
// - `global`: `randombytes` (HOT/HERE) reads `global.crypto` at import time;
// - `process.env`: `@near-js/accounts` reads `process.env.DEFAULT_FINALITY` at import time. No
//   `process.versions`, so libraries that look for Node still take their browser branch.
import { Buffer } from 'buffer';

if (!('Buffer' in globalThis)) Object.assign(globalThis, { Buffer });
if (!('global' in globalThis)) Object.assign(globalThis, { global: globalThis });
if (!('process' in globalThis)) Object.assign(globalThis, { process: { env: {} } });
