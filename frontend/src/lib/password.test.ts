import { describe, expect, it } from 'vitest';
import { generatePassword, passwordStrength } from './password';

describe('generatePassword()', () => {
  it('creates a 20-character password with every character class', () => {
    const pw = generatePassword();
    expect(pw).toHaveLength(20);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[2-9]/);
    expect(pw).toMatch(/[!@#$%^&*\-_=+?]/);
  });

  it('never goes below the 12-character API minimum and avoids ambiguous characters', () => {
    expect(generatePassword(4)).toHaveLength(12);
    const many = Array.from({ length: 50 }, () => generatePassword()).join('');
    expect(many).not.toMatch(/[0O1lI]/);
  });

  it('is random (no repeats across calls)', () => {
    const set = new Set(Array.from({ length: 100 }, () => generatePassword()));
    expect(set.size).toBe(100);
  });

  it('rates its own output as strong', () => {
    expect(passwordStrength(generatePassword())).toBe('strong');
  });
});

describe('passwordStrength()', () => {
  it.each([
    ['', 'tooShort'],
    ['Abc!1234567', 'tooShort'],
    ['aaaaaaaaaaaaaaaa', 'weak'],
    ['abcdefghijkl', 'weak'],
    ['abcdefgh1234', 'fair'],
    ['Abcdefgh1234!', 'strong'],
    ['correct horse battery staple', 'strong'],
  ] as const)('%j → %s', (pw, expected) => {
    expect(passwordStrength(pw)).toBe(expected);
  });
});
