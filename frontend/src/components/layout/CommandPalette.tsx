import { Bot, FilePlus2, HandCoins, Languages, LogOut, Moon, Search, ShieldHalf, Sparkles, type LucideIcon } from 'lucide-react';
import type { AgentRunMode } from '../../api/types';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useRunAgent } from '../../api/queries';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/cn';
import { useTheme } from '../../lib/theme';
import { useToast } from '../ui/Toast';
import { NAV_ITEMS, visibleItems } from './nav';

interface Command {
  id: string;
  label: string;
  group: 'nav' | 'action';
  icon: LucideIcon;
  keywords?: string;
  run: () => void;
}

/** Accent/case-insensitive normalisation for fuzzy-ish matching. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const { t, lang, setLang } = useI18n();
  const { can, logout } = useAuth();
  const { toggle } = useTheme();
  const navigate = useNavigate();
  const { mutate: startRun } = useRunAgent();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      inputRef.current?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  const close = () => {
    setQuery('');
    setActive(0);
    onClose();
  };

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => void navigate(to);
    const list: Command[] = visibleItems(NAV_ITEMS, can).map((n) => ({
      id: `nav-${n.id}`,
      label: t('palette.goTo', { page: t(n.labelKey) }),
      group: 'nav',
      icon: n.icon,
      keywords: n.keywords,
      run: go(n.to),
    }));
    if (can('treasury.manage')) {
      list.push({
        id: 'add-funds',
        label: t('treasury.fund.button'),
        group: 'action',
        icon: HandCoins,
        keywords: 'fund fondear deposit depositar usdt usdc binance treasury tesoreria',
        run: go('/treasury?fund=1'),
      });
    }
    if (can('bills.create')) {
      list.push({ id: 'new-bill', label: t('bills.new'), group: 'action', icon: FilePlus2, run: go('/bills?new=1') });
    }
    if (can('bills.extract')) {
      list.push({
        id: 'import-ai',
        label: t('bills.importAi'),
        group: 'action',
        icon: Sparkles,
        keywords: 'invoice factura ai ia extract',
        run: go('/bills?import=1'),
      });
    }
    if (can('agent.run')) {
      const start = (mode: AgentRunMode) => () => {
        startRun(mode, {
          onSuccess: (run) => {
            toast({ title: mode === 'RedTeamDrill' ? t('drill.started') : t('agent.started'), tone: 'success' });
            void navigate(`/agent/${run.id}`);
          },
          onError: (err) => toast({ title: t('agent.startFailed'), description: err.message, tone: 'error' }),
        });
      };
      list.push(
        {
          id: 'run-agent',
          label: t('agent.runNow'),
          group: 'action',
          icon: Bot,
          keywords: 'agent agente run ejecutar',
          run: start('Plan'),
        },
        {
          id: 'run-drill',
          label: t('drill.run'),
          group: 'action',
          icon: ShieldHalf,
          keywords: 'red team drill simulacro seguridad security attack ataque',
          run: start('RedTeamDrill'),
        },
      );
    }
    list.push(
      { id: 'theme', label: t('palette.toggleTheme'), group: 'action', icon: Moon, keywords: 'dark light oscuro claro', run: toggle },
      {
        id: 'lang',
        label: t('lang.switchTo'),
        group: 'action',
        icon: Languages,
        keywords: 'language idioma english español',
        run: () => setLang(lang === 'en' ? 'es' : 'en'),
      },
      { id: 'logout', label: t('user.logout'), group: 'action', icon: LogOut, keywords: 'sign out salir', run: logout },
    );
    return list;
  }, [t, can, navigate, startRun, toast, toggle, setLang, lang, logout]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return commands;
    return commands.filter((c) => normalize(`${c.label} ${c.keywords ?? ''}`).includes(q));
  }, [commands, query]);

  const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0));
  const execute = (cmd: Command | undefined) => {
    if (!cmd) return;
    close();
    cmd.run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (filtered.length ? (Math.min(i, filtered.length - 1) + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (filtered.length ? (Math.min(i, filtered.length - 1) - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      execute(filtered[activeIndex]);
    }
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      setQuery('');
      setActive(0);
      onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (e.target === el) {
        setQuery('');
        setActive(0);
        onClose();
      }
    };
    el.addEventListener('cancel', onCancel);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('click', onClick);
    };
  }, [onClose]);

  const optionId = (i: number) => `${listId}-opt-${String(i)}`;

  return (
    <dialog
      ref={ref}
      aria-label={t('palette.title')}
      data-testid="command-palette"
      className="m-0 mx-auto mt-[12vh] w-[calc(100vw-2rem)] max-w-xl bg-transparent p-0 backdrop:animate-fade-in"
    >
      {open ? (
        <div className="animate-fade-in overflow-hidden rounded-[10px] border border-border bg-surface text-fg shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search aria-hidden className="size-4 shrink-0 text-muted" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={filtered.length ? optionId(activeIndex) : undefined}
              aria-label={t('palette.title')}
              placeholder={t('palette.placeholder')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="h-12 w-full bg-transparent text-md outline-none placeholder:text-muted"
            />
            <kbd className="num hidden rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted sm:inline">Esc</kbd>
          </div>
          <ul id={listId} role="listbox" aria-label={t('palette.results')} className="max-h-[50vh] overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <li role="presentation" className="px-3 py-6 text-center text-sm text-muted">
                {t('palette.empty')}
              </li>
            ) : (
              filtered.map((c, i) => {
                const Icon = c.icon;
                const selected = i === activeIndex;
                return (
                  <li
                    key={c.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    data-testid={`palette-option-${c.id}`}
                    onMouseMove={() => setActive(i)}
                    onClick={() => execute(c)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') execute(c);
                    }}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm',
                      selected ? 'bg-surface-2 text-fg' : 'text-fg/90',
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0 text-muted" />
                    <span className="flex-1 truncate">{c.label}</span>
                    <span className="text-xs text-muted">{c.group === 'nav' ? t('palette.groupNav') : t('palette.groupAction')}</span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </dialog>
  );
}
