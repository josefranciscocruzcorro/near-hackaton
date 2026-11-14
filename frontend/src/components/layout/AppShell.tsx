import { MoreHorizontal, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { usePendingApprovals } from '../../api/queries';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/cn';
import { Dialog } from '../ui/Dialog';
import { CommandPalette } from './CommandPalette';
import { LanguageToggle, Logo, ModePill, SearchButton, ThemeToggle, UserMenu } from './Chrome';
import { useAuth } from '../../auth/AuthContext';
import { DemoBanner } from './DemoBanner';
import { PaymentsStoppedBanner } from '../PaymentsSwitch';
import { TreasuryFrozenBanner } from '../TreasuryFrozenBanner';
import { MORE_ITEMS, NAV_ITEMS, TAB_ITEMS, visibleItems, type NavItem } from './nav';

const COLLAPSE_KEY = 'tesorero.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function Badge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'num inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white dark:text-[#1a1203]',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function SidebarLink({ item, collapsed, count }: { item: NavItem; collapsed: boolean; count: number }) {
  const { t } = useI18n();
  const Icon = item.icon;
  const label = t(item.labelKey);
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      data-testid={`nav-${item.id}`}
      title={collapsed ? label : undefined}
      aria-label={item.badge && count > 0 ? t('nav.withCount', { label, count }) : collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          'relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
          collapsed && 'justify-center px-0',
          isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/70 hover:text-fg',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-accent" /> : null}
          <Icon aria-hidden className="size-[18px] shrink-0" />
          {collapsed ? null : <span className="flex-1 truncate">{label}</span>}
          {item.badge ? <Badge count={count} className={collapsed ? 'absolute top-0.5 right-0.5' : undefined} /> : null}
        </>
      )}
    </NavLink>
  );
}

function Sidebar({ collapsed, onToggle, pending }: { collapsed: boolean; onToggle: () => void; pending: number }) {
  const { t } = useI18n();
  const { can } = useAuth();
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[68px]' : 'w-[248px]',
      )}
    >
      <div className={cn('flex h-14 items-center border-b border-border px-4', collapsed && 'justify-center px-0')}>
        <Logo compact={collapsed} />
      </div>
      <nav aria-label={t('nav.main')} className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {visibleItems(NAV_ITEMS, can).map((item) => (
            <li key={item.id}>
              <SidebarLink item={item} collapsed={collapsed} count={item.badge ? pending : 0} />
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          aria-expanded={!collapsed}
          className={cn(
            'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted hover:bg-surface-2 hover:text-fg',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? <PanelLeftOpen aria-hidden className="size-[18px]" /> : <PanelLeftClose aria-hidden className="size-[18px]" />}
          {collapsed ? null : <span>{t('nav.collapse')}</span>}
        </button>
      </div>
    </aside>
  );
}

function BottomTabs({ pending, onMore }: { pending: number; onMore: () => void }) {
  const { t } = useI18n();
  const location = useLocation();
  const moreActive = MORE_ITEMS.some((m) => location.pathname.startsWith(m.to));
  const tabClass = (active: boolean) =>
    cn(
      'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
      active ? 'text-accent-strong' : 'text-muted',
    );
  return (
    <nav aria-label={t('nav.tabs')} className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur lg:hidden">
      <ul className="flex">
        {TAB_ITEMS.map((item) => {
          const Icon = item.icon;
          const count = item.badge ? pending : 0;
          const label = t(item.labelKey);
          return (
            <li key={item.id} className="flex flex-1">
              <NavLink
                to={item.to}
                end={item.to === '/'}
                data-testid={`tab-${item.id}`}
                aria-label={count > 0 ? t('nav.withCount', { label, count }) : undefined}
                className={({ isActive }) => tabClass(isActive)}
              >
                <span className="relative">
                  <Icon aria-hidden className="size-5" />
                  {count > 0 ? <Badge count={count} className="absolute -top-2 -right-3" /> : null}
                </span>
                <span>{label}</span>
              </NavLink>
            </li>
          );
        })}
        <li className="flex flex-1">
          <button type="button" onClick={onMore} className={tabClass(moreActive)} data-testid="tab-more" aria-haspopup="dialog">
            <MoreHorizontal aria-hidden className="size-5" />
            <span>{t('nav.more')}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  return (
    <Dialog open={open} onClose={onClose} title={t('nav.more')} testId="more-sheet">
      <nav aria-label={t('nav.more')}>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {visibleItems(MORE_ITEMS, can).map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <NavLink
                  to={item.to}
                  onClick={onClose}
                  data-testid={`more-${item.id}`}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-16 flex-col items-start justify-center gap-1.5 rounded-[10px] border border-border p-3 text-sm font-medium',
                      isActive ? 'border-accent bg-accent-soft text-accent-strong' : 'hover:bg-surface-2',
                    )
                  }
                >
                  <Icon aria-hidden className="size-5" />
                  {t(item.labelKey)}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-4 flex items-center justify-between rounded-[10px] border border-border px-3 py-1">
        <span className="text-sm text-muted">{t('nav.preferences')}</span>
        <div className="flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </div>
    </Dialog>
  );
}

export function AppShell() {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const pending = usePendingApprovals().data?.length ?? 0;

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openPalette = () => setPaletteOpen(true);

  return (
    <div className="flex min-h-dvh bg-bg">
      <a
        href="#main"
        className="sr-only z-[70] rounded-lg bg-accent-strong px-4 py-2 text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('nav.skip')}
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} pending={pending} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DemoBanner />
        <TreasuryFrozenBanner />
        <PaymentsStoppedBanner />
        <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-4 lg:px-6">
            <div className="min-w-0 lg:hidden">
              <Logo shrink />
            </div>
            <div className="hidden flex-1 lg:block">
              <SearchButton onOpen={openPalette} />
            </div>
            <div className="ml-auto flex items-center gap-0.5 sm:gap-1.5">
              <ModePill compact />
              <div className="lg:hidden">
                <SearchButton compact onOpen={openPalette} />
              </div>
              {/* The language switch stays visible on phones too: people look for it here first. */}
              <LanguageToggle />
              <div className="hidden lg:block">
                <ThemeToggle />
              </div>
              <UserMenu />
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-5 pb-28 outline-none sm:px-6 lg:px-8 lg:pb-10">
          <Outlet />
        </main>
      </div>
      <BottomTabs pending={pending} onMore={() => setMoreOpen(true)} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
