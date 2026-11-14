import { FlaskConical, KeyRound, Languages, LogOut, Moon, Radio, Search, Settings as SettingsIcon, Sun } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useSettings } from '../../api/queries';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/cn';
import { useTheme } from '../../lib/theme';
import { ChangePasswordDialog } from '../ChangePasswordDialog';
import { Tooltip } from '../ui/Tooltip';

/** `shrink`: on very narrow phones only the mark shows (the name stays for screen readers). */
export function Logo({ compact = false, shrink = false }: { compact?: boolean; shrink?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 64 64" className="size-7 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="14" className="fill-accent-strong" />
        <path d="M21 22h22v6h-8v20h-6V28h-8z" fill="#fff" />
        <circle cx="44" cy="44" r="6" fill="#fff" />
        <circle cx="44" cy="44" r="2.6" className="fill-accent-strong" />
      </svg>
      {compact ? null : <span className={cn('text-md font-semibold tracking-tight', shrink && 'max-[379px]:sr-only')}>Tesorero</span>}
    </span>
  );
}

/** Execution mode pill (Simulation / Live) → settings. */
export function ModePill({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { data } = useSettings();
  if (!data) return null;
  const live = data.executionMode === 'Live';
  const Icon = live ? Radio : FlaskConical;
  return (
    <Tooltip content={live ? t('mode.liveHint') : t('mode.simulationHint')} side="bottom" align="end">
      {(id) => (
        <Link
          to="/settings"
          aria-describedby={id}
          aria-label={t('mode.aria', { mode: t(`mode.${data.executionMode}`) })}
          data-testid="execution-mode-pill"
          data-mode={data.executionMode}
          className={cn(
            'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold pointer-fine:min-h-8',
            live ? 'border-warning/40 bg-warning-soft text-warning' : 'border-info/30 bg-info-soft text-info',
          )}
        >
          <Icon aria-hidden className={cn('size-3.5', live && 'animate-pulse-soft')} />
          <span className={cn(compact && 'sr-only sm:not-sr-only')}>{t(`mode.${data.executionMode}`)}</span>
        </Link>
      )}
    </Tooltip>
  );
}

const iconBtn =
  'inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg pointer-fine:size-9';

export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const { t } = useI18n();
  const dark = resolved === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      className={iconBtn}
      aria-label={dark ? t('theme.toLight') : t('theme.toDark')}
      title={dark ? t('theme.toLight') : t('theme.toDark')}
      data-testid="theme-toggle"
    >
      {dark ? <Sun aria-hidden className="size-[18px]" /> : <Moon aria-hidden className="size-[18px]" />}
    </button>
  );
}

export function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  const next = lang === 'en' ? 'es' : 'en';
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      className={cn(iconBtn, 'w-auto gap-1 px-2 text-xs font-semibold pointer-fine:w-auto')}
      aria-label={t('lang.switchTo')}
      title={t('lang.switchTo')}
      data-testid="language-toggle"
    >
      <Languages aria-hidden className="size-[18px]" />
      <span aria-hidden className="uppercase">
        {lang}
      </span>
    </button>
  );
}

export function SearchButton({ onOpen, compact = false }: { onOpen: () => void; compact?: boolean }) {
  const { t } = useI18n();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
  if (compact) {
    return (
      <button type="button" onClick={onOpen} className={iconBtn} aria-label={t('palette.open')} data-testid="command-palette-trigger">
        <Search aria-hidden className="size-[18px]" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="command-palette-trigger"
      aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
      className="inline-flex h-9 w-full max-w-sm items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-muted hover:border-muted/60"
    >
      <Search aria-hidden className="size-4" />
      <span className="flex-1 truncate text-left">{t('palette.placeholder')}</span>
      <kbd className="num rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px]">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        data-testid="user-menu-trigger"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1.5 hover:bg-surface-2 pointer-fine:min-h-9"
      >
        <span aria-hidden className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">
          {initials(user.name)}
        </span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-sm font-medium">{user.name}</span>
          <span className="block text-xs text-muted">{t(`role.${user.role}`)}</span>
        </span>
        <span className="sr-only md:hidden">{t('user.menu', { name: user.name, role: t(`role.${user.role}`) })}</span>
      </button>
      {open ? (
        <div
          id={menuId}
          className="absolute right-0 z-50 mt-2 w-64 animate-fade-in rounded-[10px] border border-border bg-surface p-1.5 shadow-xl"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <p className="mt-1.5 inline-flex rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong" data-testid="user-role">
              {t(`role.${user.role}`)}
            </p>
            <p className="mt-1.5 text-xs text-muted">{t(`role.${user.role}.desc`)}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 pointer-fine:min-h-9"
          >
            <SettingsIcon aria-hidden className="size-4 text-muted" />
            {t('nav.settings')}
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setPasswordOpen(true);
            }}
            data-testid="change-password-button"
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm hover:bg-surface-2 pointer-fine:min-h-9"
          >
            <KeyRound aria-hidden className="size-4 text-muted" />
            {t('password.change')}
          </button>
          <button
            type="button"
            onClick={logout}
            data-testid="logout-button"
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-danger hover:bg-danger-soft pointer-fine:min-h-9"
          >
            <LogOut aria-hidden className="size-4" />
            {t('user.logout')}
          </button>
        </div>
      ) : null}
      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}
