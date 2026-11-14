import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setRequestLanguage } from '../api/client';
import { en, type TranslationKey } from './en';
import { es } from './es';

export type Lang = 'en' | 'es';
export const LANGS: readonly Lang[] = ['en', 'es'];
export type Vars = Record<string, string | number>;

const dictionaries: Record<Lang, Record<TranslationKey, string>> = { en, es };
const STORAGE_KEY = 'tesorero.lang';

/**
 * Replaces `{name}` placeholders. Unknown placeholders are left untouched. A value that already ends
 * the sentence ("1:01 p. m.") swallows the template's own period, so it never reads "p. m..".
 */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}(\.?)/g, (match, name: string, dot: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    const text = String(value);
    return dot && text.endsWith('.') ? text : text + dot;
  });
}

export function translate(lang: Lang, key: TranslationKey, vars?: Vars): string {
  return interpolate(dictionaries[lang][key], vars);
}

/** Intl locale used for numbers and dates in each language. */
export const LOCALES: Record<Lang, string> = { en: 'en-US', es: 'es-EC' };

function readStoredLang(): Lang | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'es') return stored;
  } catch {
    // ignore
  }
  return null;
}

/** Browser language: any Spanish variant → es, everything else → en. */
export function browserLang(languages: readonly string[] = navigator.languages.length > 0 ? navigator.languages : [navigator.language]): Lang {
  const first = languages.find(Boolean) ?? '';
  return first.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export type TFunction = (key: TranslationKey, vars?: Vars) => string;

interface I18nValue {
  lang: Lang;
  locale: string;
  /** The person's explicit choice: remembered on this device. */
  setLang: (lang: Lang) => void;
  /**
   * The organization's language (from signup): applied only while the person has not chosen one.
   * Order: stored choice → organization → browser → English.
   */
  applyDefaultLang: (lang: Lang) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, initialLang }: { children: ReactNode; initialLang?: Lang }) {
  const [chosen, setChosen] = useState<boolean>(() => initialLang !== undefined || readStoredLang() !== null);
  const [lang, setLangState] = useState<Lang>(() => {
    const initial = initialLang ?? readStoredLang() ?? browserLang();
    setRequestLanguage(initial);
    return initial;
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    setRequestLanguage(lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setRequestLanguage(next);
    setLangState(next);
    setChosen(true);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const applyDefaultLang = useCallback(
    (next: Lang) => {
      if (chosen) return;
      setRequestLanguage(next);
      setLangState(next);
    },
    [chosen],
  );

  const value = useMemo<I18nValue>(
    () => ({ lang, locale: LOCALES[lang], setLang, applyDefaultLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang, applyDefaultLang],
  );

  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

export type { TranslationKey };
