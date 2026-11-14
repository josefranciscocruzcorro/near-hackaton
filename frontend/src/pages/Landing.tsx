import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  Crosshair,
  FileSearch,
  GitBranch,
  Globe,
  Landmark,
  Scale,
  ScanSearch,
  ShieldCheck,
  UserCheck,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, type MouseEvent } from 'react';
import { useLocation } from 'react-router';
import { useInstance } from '../api/queries';
import type { Role } from '../api/types';
import { LanguageToggle, Logo, ThemeToggle } from '../components/layout/Chrome';
import { buttonClasses } from '../components/ui/Button';
import { useI18n, type TranslationKey } from '../i18n';
import { cn } from '../lib/cn';
import { useMediaQuery } from '../lib/useMediaQuery';
import { HeroVisual } from './landing/HeroVisual';
import { SIGNUP_FIRST_FIELD_ID, SignupSection } from './landing/SignupSection';
import { VideoSection } from './landing/VideoSection';

const DEFAULT_BASE_DOMAIN = 'tesorero.gesco.ec';
/** Placeholder until the repository is public. */
const GITHUB_URL = '#';

/** Scrolls to the signup form and puts the cursor in its first field. */
function useGoToSignup() {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (e?: MouseEvent) => {
    e?.preventDefault();
    document.getElementById('signup')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    document.getElementById(SIGNUP_FIRST_FIELD_ID)?.focus({ preventScroll: true });
  };
}

/** Public landing on the apex domain (ADR-0006). No app shell, no login. */
export function LandingPage() {
  const { t } = useI18n();
  const instance = useInstance().data;
  const baseDomain = instance?.baseDomain ?? DEFAULT_BASE_DOMAIN;
  const demoUrl = instance?.demoUrl ?? `https://demo.${baseDomain}`;
  const { hash } = useLocation();

  useEffect(() => {
    document.title = t('landing.meta.title');
  }, [t]);

  // Deep links such as /#signup (from the verification page) land on their section.
  useEffect(() => {
    if (hash.length > 1) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <div className="landing-root min-h-dvh overflow-x-clip bg-bg text-fg">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-surface px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t('nav.skip')}
      </a>
      <TopBar demoUrl={demoUrl} />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero demoUrl={demoUrl} />
        <VideoSection demoUrl={demoUrl} />
        <HowItWorks />
        <Security />
        <Roles />
        <SignupSection baseDomain={baseDomain} />
        <Faq />
      </main>
      <Footer demoUrl={demoUrl} />
    </div>
  );
}

function Kicker({ children }: { children: string }) {
  return <p className="num text-xs font-medium tracking-[0.14em] text-accent-strong uppercase">{children}</p>;
}

function SectionHeading({ id, kicker, title, body }: { id: string; kicker: string; title: string; body: string }) {
  return (
    <div className="max-w-2xl">
      <Kicker>{kicker}</Kicker>
      <h2 id={id} className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-[2.5rem] sm:leading-[1.1]">
        {title}
      </h2>
      <p className="mt-4 text-md text-muted">{body}</p>
    </div>
  );
}

function TopBar({ demoUrl }: { demoUrl: string }) {
  const { t } = useI18n();
  const goToSignup = useGoToSignup();
  const links: [string, TranslationKey][] = [
    ['#how', 'landing.nav.how'],
    ['#security', 'landing.nav.security'],
    ['#roles', 'landing.nav.roles'],
    ['#faq', 'landing.nav.faq'],
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <a href="#main" className="rounded-lg">
          <Logo />
        </a>
        <nav aria-label={t('landing.nav.label')} className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {links.map(([href, key]) => (
              <li key={href}>
                <a href={href} className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-fg">
                  {t(key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-0.5 sm:gap-1">
          <div className="hidden sm:block">
            <a href={demoUrl} className={buttonClasses('ghost', 'sm')} data-testid="landing-nav-demo">
              {t('landing.nav.demo')}
            </a>
          </div>
          <LanguageToggle />
          <ThemeToggle />
          <a href="#signup" onClick={goToSignup} className={buttonClasses('primary', 'sm', 'ml-1')} data-testid="landing-nav-signup">
            <span className="sm:hidden">{t('landing.nav.signupShort')}</span>
            <span className="hidden sm:inline">{t('landing.nav.signup')}</span>
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero({ demoUrl }: { demoUrl: string }) {
  const { t } = useI18n();
  const goToSignup = useGoToSignup();
  return (
    <div className="px-2 pt-2 sm:px-4 sm:pt-4">
      {/* The hero is always dark (scoped `.dark` tokens), in both themes. */}
      <section
        aria-labelledby="hero-title"
        data-testid="landing-hero"
        className="dark relative isolate overflow-hidden rounded-[18px] border border-border bg-bg text-fg"
      >
        <div aria-hidden className="landing-grid pointer-events-none absolute inset-0 -z-10" />
        <div aria-hidden className="landing-glow pointer-events-none absolute -top-40 right-[-10%] -z-10 size-[640px] rounded-full" />
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 py-14 sm:px-8 sm:py-20 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:gap-10 lg:py-24">
          <div className="min-w-0">
            <p className="num inline-flex max-w-full items-center gap-2 rounded-2xl border border-border bg-surface/70 px-3 py-1 text-xs text-muted sm:rounded-full">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
              <span>{t('landing.hero.kicker')}</span>
            </p>
            <h1 id="hero-title" className="mt-6 text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.025em] sm:text-[3.5rem] sm:leading-[1.04]">
              <span className="block">{t('landing.hero.title1')}</span>{' '}
              <span className="block text-accent">{t('landing.hero.title2')}</span>{' '}
              <span className="block">{t('landing.hero.title3')}</span>
            </h1>
            <p className="mt-6 max-w-xl text-md leading-relaxed text-muted">{t('landing.hero.body')}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={demoUrl} className={buttonClasses('primary', 'md', 'h-12 px-5 text-md')} data-testid="landing-demo-link">
                {t('landing.hero.demo')}
                <ArrowUpRight aria-hidden className="size-4" />
              </a>
              <a href="#signup" onClick={goToSignup} className={buttonClasses('secondary', 'md', 'h-12 px-5 text-md')} data-testid="landing-cta-signup">
                {t('landing.hero.signup')}
                <ArrowRight aria-hidden className="size-4" />
              </a>
            </div>
            <p className="mt-4 text-sm text-muted">{t('landing.hero.note')}</p>
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-6 text-sm">
              {(['landing.hero.fact1', 'landing.hero.fact2', 'landing.hero.fact3'] as const).map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <ShieldCheck aria-hidden className="size-4 text-accent" />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
          <HeroVisual />
        </div>
      </section>
    </div>
  );
}

const STEPS: { icon: LucideIcon; title: TranslationKey; body: TranslationKey }[] = [
  { icon: Bot, title: 'landing.how.s1.title', body: 'landing.how.s1.body' },
  { icon: Scale, title: 'landing.how.s2.title', body: 'landing.how.s2.body' },
  { icon: UserCheck, title: 'landing.how.s3.title', body: 'landing.how.s3.body' },
  { icon: Landmark, title: 'landing.how.s4.title', body: 'landing.how.s4.body' },
  { icon: Globe, title: 'landing.how.s5.title', body: 'landing.how.s5.body' },
];

function HowItWorks() {
  const { t } = useI18n();
  return (
    <section id="how" aria-labelledby="how-title" className="border-y border-border bg-surface px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeading id="how-title" kicker={t('landing.how.kicker')} title={t('landing.how.title')} body={t('landing.how.body')} />
        <ol className="relative mt-14 grid gap-8 lg:grid-cols-5 lg:gap-6">
          {/* Connector: vertical on mobile, horizontal through the icons on desktop. */}
          <span aria-hidden className="absolute top-2 bottom-2 left-[21px] w-px bg-gradient-to-b from-accent/60 via-border to-border lg:top-[21px] lg:right-[10%] lg:bottom-auto lg:left-[10%] lg:h-px lg:w-auto lg:bg-gradient-to-r" />
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.title} className="relative grid grid-cols-[44px_1fr] gap-4 lg:grid-cols-1 lg:justify-items-center lg:text-center">
                <span className="relative flex size-11 items-center justify-center rounded-full border border-border bg-bg text-accent-strong shadow-sm">
                  <Icon aria-hidden className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="num text-xs text-muted">
                    <span className="sr-only">{t('landing.how.step', { n: i + 1 })}</span>
                    <span aria-hidden>{String(i + 1).padStart(2, '0')}</span>
                  </p>
                  <h3 className="mt-1 text-md font-semibold">{t(s.title)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{t(s.body)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function BulletList({ items, className }: { items: TranslationKey[]; className?: string }) {
  const { t } = useI18n();
  return (
    <ul className={cn('space-y-3', className)}>
      {items.map((k) => (
        <li key={k} className="flex items-start gap-2.5 text-sm leading-relaxed">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-strong" />
          <span>{t(k)}</span>
        </li>
      ))}
    </ul>
  );
}

function Security() {
  const { t } = useI18n();
  const contract: [string, string, boolean?][] = [
    ['max_per_payment', '2,000.00 USDC'],
    ['daily_limit', '5,000.00 USDC'],
    ['caller', t('landing.security.code.agentOnly')],
    ['duplicate_bill', t('landing.security.code.rejected')],
    ['paused', 'false'],
    ['owner', t('landing.security.code.yourWallet'), true],
  ];
  return (
    <section id="security" aria-labelledby="security-title" className="px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          id="security-title"
          kicker={t('landing.security.kicker')}
          title={t('landing.security.title')}
          body={t('landing.security.body')}
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <article className="rounded-[10px] border border-border bg-surface p-6 sm:p-7">
            <p className="num text-xs text-muted">{t('landing.security.layer', { n: 1 })}</p>
            <h3 className="mt-2 flex items-center gap-2 text-lg font-semibold">
              <Scale aria-hidden className="size-5 text-accent-strong" />
              {t('landing.security.off.title')}
            </h3>
            <BulletList
              className="mt-5"
              items={['landing.security.off.p1', 'landing.security.off.p2', 'landing.security.off.p3', 'landing.security.off.p4']}
            />
          </article>
          <article className="rounded-[10px] border border-accent/30 bg-surface p-6 sm:p-7">
            <p className="num text-xs text-muted">{t('landing.security.layer', { n: 2 })}</p>
            <h3 className="mt-2 flex items-center gap-2 text-lg font-semibold">
              <Landmark aria-hidden className="size-5 text-accent-strong" />
              {t('landing.security.on.title')}
            </h3>
            <BulletList
              className="mt-5"
              items={['landing.security.on.p1', 'landing.security.on.p2', 'landing.security.on.p3', 'landing.security.on.p4', 'landing.security.on.p5']}
            />
            <figure className="num mt-6 overflow-hidden rounded-lg border border-border bg-surface-2 text-xs">
              <figcaption className="flex items-center gap-2 border-b border-border px-3 py-2 text-muted">
                <span aria-hidden className="size-2 rounded-full bg-accent" />
                <span className="sr-only">{t('landing.security.code.label')}: </span>
                treasury.tesorero.near
              </figcaption>
              <dl className="py-1">
                {contract.map(([k, v, accent]) => (
                  <div key={k} className="flex items-center justify-between gap-4 px-3 py-1.5">
                    <dt className="text-muted">{k}</dt>
                    <dd className={cn('truncate text-right', accent ? 'text-accent-strong' : 'text-fg')}>{v}</dd>
                  </div>
                ))}
              </dl>
            </figure>
          </article>
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <FeatureCard icon={ScanSearch} title={t('landing.security.fraud.title')} body={t('landing.security.fraud.body')} />
          <FeatureCard icon={Crosshair} title={t('landing.security.drill.title')} body={t('landing.security.drill.body')} />
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <article className="flex gap-4 rounded-[10px] border border-border bg-surface p-6">
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <h3 className="text-md font-semibold">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
      </div>
    </article>
  );
}

const ROLE_CARDS: { role: Role; icon: LucideIcon }[] = [
  { role: 'Owner', icon: UserCog },
  { role: 'Approver', icon: ShieldCheck },
  { role: 'Auditor', icon: FileSearch },
];

function Roles() {
  const { t } = useI18n();
  return (
    <section id="roles" aria-labelledby="roles-title" className="border-y border-border bg-surface px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeading id="roles-title" kicker={t('landing.roles.kicker')} title={t('landing.roles.title')} body={t('landing.roles.body')} />
        <ul className="mt-12 grid gap-5 md:grid-cols-3">
          {ROLE_CARDS.map(({ role, icon: Icon }) => (
            <li key={role} className="flex flex-col rounded-[10px] border border-border bg-bg p-6" data-testid={`landing-role-${role.toLowerCase()}`}>
              <span aria-hidden className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{t(`role.${role}`)}</h3>
              <p className="text-sm text-muted">{t(`role.${role}.short`)}</p>
              <BulletList className="mt-5" items={[`landing.roles.${role}.p1`, `landing.roles.${role}.p2`, `landing.roles.${role}.p3`]} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Faq() {
  const { t } = useI18n();
  const items = [1, 2, 3, 4, 5] as const;
  return (
    <section id="faq" aria-labelledby="faq-title" className="border-t border-border px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <Kicker>{t('landing.faq.kicker')}</Kicker>
          <h2 id="faq-title" className="mt-3 text-2xl font-semibold tracking-tight sm:text-[2.5rem] sm:leading-[1.1]">
            {t('landing.faq.title')}
          </h2>
        </div>
        <div className="divide-y divide-border border-y border-border">
          {items.map((n) => (
            <details key={n} className="group" data-testid={`landing-faq-${String(n)}`}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-5 text-md font-medium [&::-webkit-details-marker]:hidden">
                {t(`landing.faq.q${n}`)}
                <ChevronDown aria-hidden className="size-5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <p className="pb-5 text-sm leading-relaxed text-muted">{t(`landing.faq.a${n}`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer({ demoUrl }: { demoUrl: string }) {
  const { t } = useI18n();
  return (
    <footer className="border-t border-border bg-surface px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo />
          <p className="mt-2 text-sm text-muted">{t('landing.footer.tagline')}</p>
        </div>
        <nav aria-label={t('landing.footer.links')}>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <li>
              <a href={demoUrl} className="inline-flex min-h-11 items-center gap-1 text-muted hover:text-fg pointer-fine:min-h-0">
                {t('landing.nav.demo')}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </a>
            </li>
            <li>
              <a href={GITHUB_URL} className="inline-flex min-h-11 items-center gap-1.5 text-muted hover:text-fg pointer-fine:min-h-0">
                <GitBranch aria-hidden className="size-3.5" />
                {t('landing.footer.github')}
              </a>
            </li>
            <li className="num text-xs text-muted">{t('landing.footer.built')}</li>
            <li className="num text-xs text-muted">© 2026 Tesorero</li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
