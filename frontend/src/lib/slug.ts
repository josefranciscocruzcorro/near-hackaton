import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../api/types';

/**
 * Suggests a subdomain from an organization name: "Café Andino S.A." → "cafe-andino-s-a".
 * Strips accents, keeps `[a-z0-9]`, joins words with single hyphens and trims to 30 characters.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

/** Light normalization while typing: lowercase, spaces → hyphens (invalid characters stay visible). */
export function normalizeSlugInput(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '-').slice(0, SLUG_MAX_LENGTH + 10);
}

export const isValidSlug = (slug: string): boolean => SLUG_PATTERN.test(slug);

/**
 * NEAR account id rules (nearcore): 2–64 chars, lowercase alphanumerics separated by `-`, `_` or `.`
 * (no leading/trailing or doubled separators). Implicit accounts are 64 hex chars and also match.
 */
const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const isValidNearAccountId = (id: string): boolean => NEAR_ACCOUNT.test(id);
