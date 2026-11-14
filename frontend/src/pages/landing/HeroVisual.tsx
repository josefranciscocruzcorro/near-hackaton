import { ArrowRight, Bot, Hourglass, Info, OctagonX, Pause, Play, Scale, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PolicyOutcome } from '../../api/types';
import { Chip } from '../../components/ui/Chip';
import { useI18n, type TranslationKey } from '../../i18n';
import { cn } from '../../lib/cn';
import { formatUsd } from '../../lib/format';
import { OUTCOME_VISUAL, TONE_TEXT, type Tone } from '../../lib/status';
import { useMediaQuery } from '../../lib/useMediaQuery';

interface Scenario {
  reference: string;
  payee: string;
  amount: number;
  destination: string;
  outcome: PolicyOutcome;
  reason: TranslationKey;
  rules: { key: TranslationKey; tone: Tone; icon: LucideIcon }[];
  next: TranslationKey;
  nextIcon: LucideIcon;
}

/** Three sample decisions of one agent run — one per policy outcome (same story as the demo seed). */
const SCENARIOS: Scenario[] = [
  {
    reference: 'INV-2041',
    payee: 'Andes Coffee Co.',
    amount: 1250,
    destination: 'USDC · Base',
    outcome: 'Allow',
    reason: 'landing.visual.s1.reason',
    rules: [{ key: 'landing.visual.s1.rule', tone: 'info', icon: Info }],
    next: 'landing.visual.s1.next',
    nextIcon: ArrowRight,
  },
  {
    reference: 'INV-2042',
    payee: 'Pixel & Pine Studio',
    amount: 8400,
    destination: 'USDC · Solana',
    outcome: 'RequireApproval',
    reason: 'landing.visual.s2.reason',
    rules: [{ key: 'landing.visual.s2.rule', tone: 'warning', icon: TriangleAlert }],
    next: 'landing.visual.s2.next',
    nextIcon: Hourglass,
  },
  {
    reference: 'INV-2043',
    payee: 'Andes Coffee Co.',
    amount: 9900,
    destination: 'USDT · Arbitrum',
    outcome: 'Block',
    reason: 'landing.visual.s3.reason',
    rules: [
      { key: 'landing.visual.s3.rule', tone: 'danger', icon: OctagonX },
      { key: 'landing.visual.s3.rule2', tone: 'danger', icon: OctagonX },
    ],
    next: 'landing.visual.s3.next',
    nextIcon: OctagonX,
  },
];

const CYCLE_MS = 4200;

/**
 * Hero illustration: a stack of reasoning cards (AI proposal → policy verdict) that cycles through
 * Allowed / Requires approval / Blocked. Decorative for assistive tech (an sr-only sentence states
 * the same), pausable (WCAG 2.2.2) and static under prefers-reduced-motion.
 */
export function HeroVisual() {
  const { t, locale } = useI18n();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const playing = !paused && !reducedMotion;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % SCENARIOS.length), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  return (
    <figure className="relative mx-auto w-full max-w-[460px] min-w-0" data-testid="hero-visual">
      <figcaption className="sr-only">{t('landing.visual.label')}</figcaption>
      {/* All cards share one grid cell, so the stack is as tall as its tallest card in any language. */}
      <div aria-hidden="true" className="grid grid-cols-1 pt-10">
        {SCENARIOS.map((s, i) => {
          const depth = (i - active + SCENARIOS.length) % SCENARIOS.length;
          return (
            <div
              key={s.reference}
              data-depth={depth}
              className={cn(
                'col-start-1 row-start-1 origin-top rounded-[14px] border bg-surface/95 p-4 shadow-2xl shadow-black/40 backdrop-blur transition-[transform,opacity] duration-500 ease-out sm:p-5',
                depth === 0 ? 'border-accent/30' : 'border-border',
              )}
              style={{
                transform: `translateY(${String(-depth * 18)}px) scale(${String(1 - depth * 0.05)})`,
                opacity: depth === 0 ? 1 : depth === 1 ? 0.55 : 0.28,
                zIndex: SCENARIOS.length - depth,
              }}
            >
              <ScenarioCard scenario={s} locale={locale} />
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1" role="group" aria-label={t('landing.visual.examples')}>
          {SCENARIOS.map((s, i) => (
            <button
              key={s.reference}
              type="button"
              aria-pressed={i === active}
              aria-label={t('landing.visual.example', { n: i + 1, outcome: t(`outcome.${s.outcome}`) })}
              onClick={() => {
                setActive(i);
                setPaused(true);
              }}
              className="group flex h-11 w-9 items-center justify-center pointer-fine:h-8"
            >
              <span
                aria-hidden
                className={cn(
                  'h-1 w-full rounded-full transition-colors duration-200',
                  i === active ? 'bg-accent' : 'bg-border group-hover:bg-muted',
                )}
              />
            </button>
          ))}
        </div>
        {reducedMotion ? null : (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? t('landing.visual.play') : t('landing.visual.pause')}
            title={paused ? t('landing.visual.play') : t('landing.visual.pause')}
            className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg pointer-fine:size-8"
            data-testid="hero-visual-toggle"
          >
            {paused ? <Play aria-hidden className="size-4" /> : <Pause aria-hidden className="size-4" />}
          </button>
        )}
      </div>
    </figure>
  );
}

function ScenarioCard({ scenario: s, locale }: { scenario: Scenario; locale: string }) {
  const { t } = useI18n();
  const outcome = OUTCOME_VISUAL[s.outcome];
  const NextIcon = s.nextIcon;
  return (
    <div className="space-y-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="num truncate text-xs text-muted">
            {s.reference} · {t('landing.visual.run')}
          </p>
          <p className="mt-0.5 truncate text-md font-semibold">{s.payee}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-md font-medium">{formatUsd(s.amount, locale)}</p>
          <p className="num mt-0.5 text-xs text-muted">{s.destination}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface-2/60 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
          <Bot className="size-3.5" />
          {t('landing.visual.proposal')}
        </p>
        <p className="mt-1 text-sm leading-snug">{t(s.reason)}</p>
      </div>

      <div className="rounded-lg border border-border px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            <Scale className="size-3.5" />
            {t('landing.visual.verdict')}
          </p>
          <Chip tone={outcome.tone} icon={outcome.icon}>
            {t(`outcome.${s.outcome}`)}
          </Chip>
        </div>
        <ul className="mt-2 space-y-1.5">
          {s.rules.map((r) => {
            const Icon = r.icon;
            return (
              <li key={r.key} className="flex items-start gap-2 text-sm leading-snug">
                <Icon className={cn('mt-0.5 size-3.5 shrink-0', TONE_TEXT[r.tone])} />
                <span>{t(r.key)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <p className={cn('flex items-center gap-1.5 text-xs font-medium', TONE_TEXT[outcome.tone])}>
        <NextIcon className="size-3.5 shrink-0" />
        {t(s.next)}
      </p>
    </div>
  );
}
