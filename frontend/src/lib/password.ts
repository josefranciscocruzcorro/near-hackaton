import { MIN_PASSWORD_LENGTH } from '../api/types';

export type PasswordStrength = 'tooShort' | 'weak' | 'fair' | 'strong';

/**
 * Rough strength hint for the UI. The API only enforces the minimum length; the rest nudges people
 * towards longer passphrases or a mix of character classes.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) return 'tooShort';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const unique = new Set(password).size;
  if (unique < 5) return 'weak';
  if (password.length >= 20 || (password.length >= 14 && classes >= 3) || classes === 4) return 'strong';
  if (classes >= 2 || password.length >= 16) return 'fair';
  return 'weak';
}

// No ambiguous characters (0/O, 1/l/I) so a temporary password can be read out or retyped safely.
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+?';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** Unbiased random index in [0, max) using rejection sampling over crypto.getRandomValues. */
function randomIndex(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0] ?? 0;
    if (v < limit) return v % max;
  }
}

function pick(set: string): string {
  return set.charAt(randomIndex(set.length));
}

/** Strong random password (default 20 chars) with at least one char of every class. */
export function generatePassword(length = 20): string {
  const size = Math.max(length, MIN_PASSWORD_LENGTH);
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < size) chars.push(pick(ALL));
  // Fisher–Yates shuffle so the guaranteed classes are not always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    const a = chars[i] ?? '';
    chars[i] = chars[j] ?? '';
    chars[j] = a;
  }
  return chars.join('');
}
