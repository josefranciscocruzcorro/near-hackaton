// Browser stand-in for Node's `crypto`, used only by the HOT/HERE wallet SDK (it needs
// `randomBytes` for a signing nonce). Aliased in vite.config.ts for the build; Web Crypto backs it.
import { Buffer } from 'buffer';

export function randomBytes(size: number): Buffer {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes);
}

export default { randomBytes };
