import { ArrowUpRight, Film, PlayCircle } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { buttonClasses } from '../../components/ui/Button';
import { LANGS, useI18n, type Lang } from '../../i18n';
import { cn } from '../../lib/cn';

// /media is cached for a day: bump this when the videos are re-recorded.
const MEDIA_VERSION = '2026-11-14c';
/** Served by nginx (CONTRACT.md); may be missing in development. Captions are burned in. */
export const VIDEO_SOURCES: Record<Lang, { src: string; poster: string }> = {
  en: { src: `/media/tesorero-demo-en.mp4?v=${MEDIA_VERSION}`, poster: `/media/poster-en.jpg?v=${MEDIA_VERSION}` },
  es: { src: `/media/tesorero-demo-es.mp4?v=${MEDIA_VERSION}`, poster: `/media/poster-es.jpg?v=${MEDIA_VERSION}` },
};

export function VideoSection({ demoUrl }: { demoUrl: string }) {
  const { t, lang } = useI18n();
  // Follows the UI language until the visitor picks a tab.
  const [choice, setChoice] = useState<Lang | null>(null);
  const [failed, setFailed] = useState<Partial<Record<Lang, boolean>>>({});
  const active = choice ?? lang;
  const base = useId();
  const tabRefs = useRef<Partial<Record<Lang, HTMLButtonElement | null>>>({});
  const panelId = `${base}-panel`;
  const tabId = (l: Lang) => `${base}-tab-${l}`;

  const select = (l: Lang, focus = false) => {
    setChoice(l);
    if (focus) tabRefs.current[l]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = LANGS.indexOf(active);
    let next: Lang | undefined;
    if (e.key === 'ArrowRight') next = LANGS[(i + 1) % LANGS.length];
    else if (e.key === 'ArrowLeft') next = LANGS[(i - 1 + LANGS.length) % LANGS.length];
    else if (e.key === 'Home') next = LANGS[0];
    else if (e.key === 'End') next = LANGS[LANGS.length - 1];
    if (next) {
      e.preventDefault();
      select(next, true);
    }
  };

  const source = VIDEO_SOURCES[active];
  const label = t('landing.video.label', { lang: t(`lang.name.${active}`) });

  return (
    <section aria-labelledby="video-title" className="px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="num text-xs font-medium tracking-[0.14em] text-accent-strong uppercase">{t('landing.video.kicker')}</p>
            <h2 id="video-title" className="mt-3 text-2xl font-semibold tracking-tight sm:text-[2.5rem] sm:leading-[1.1]">
              {t('landing.video.title')}
            </h2>
            <p className="mt-4 text-md text-muted">{t('landing.video.body')}</p>
          </div>
          <div role="tablist" aria-label={t('landing.video.tabs')} className="inline-flex shrink-0 self-start rounded-lg border border-border bg-surface-2 p-1 md:self-auto">
            {LANGS.map((l) => (
              <button
                key={l}
                ref={(el) => {
                  tabRefs.current[l] = el;
                }}
                id={tabId(l)}
                type="button"
                role="tab"
                aria-selected={active === l}
                aria-controls={panelId}
                tabIndex={active === l ? 0 : -1}
                onClick={() => select(l)}
                onKeyDown={onKeyDown}
                data-testid={`video-tab-${l}`}
                className={cn(
                  'inline-flex min-h-11 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors pointer-fine:min-h-9',
                  active === l ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
                )}
              >
                <span className="num text-xs uppercase">{l}</span>
                {t(`lang.name.${l}`)}
              </button>
            ))}
          </div>
        </div>

        <div id={panelId} role="tabpanel" aria-labelledby={tabId(active)} className="mt-8">
          <div className="relative aspect-video overflow-hidden rounded-[14px] border border-border bg-[#0b0b0c] shadow-xl">
            {/* Shown behind the player until the poster or the first frame paints over it. */}
            <div aria-hidden className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(ellipse_at_center,rgb(52_211_153/0.16),transparent_65%)] text-[#a1a1aa]">
              <PlayCircle className="size-12 text-[#34d399]" strokeWidth={1.25} />
              <span className="px-6 text-center text-sm">{t('landing.video.placeholder')}</span>
            </div>
            {failed[active] ? (
              <div role="status" data-testid="landing-video-unavailable" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0b0b0c] px-6 text-center text-[#f5f5f4]">
                <Film aria-hidden className="size-10 text-[#a1a1aa]" strokeWidth={1.25} />
                <p className="text-md font-semibold">{t('landing.video.unavailable')}</p>
                <p className="max-w-md text-sm text-[#a1a1aa]">{t('landing.video.unavailableBody')}</p>
                <a href={demoUrl} className={buttonClasses('primary', 'md', 'mt-2 bg-[#34d399] text-[#04130d]')}>
                  {t('landing.hero.demo')}
                  <ArrowUpRight aria-hidden className="size-4" />
                </a>
              </div>
            ) : (
              // Captions are burned into both videos, so there is no separate <track>.
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                key={active}
                controls
                preload="none"
                playsInline
                poster={source.poster}
                src={source.src}
                aria-label={label}
                onError={() => setFailed((f) => ({ ...f, [active]: true }))}
                className="relative size-full bg-transparent object-contain"
                data-testid="landing-video"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
