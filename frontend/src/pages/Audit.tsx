import { Bot, Cog, ScrollText, UserRound, type LucideIcon } from 'lucide-react';
import { useAudit } from '../api/queries';
import type { ActorType, AuditEntry } from '../api/types';
import { ExportCsvButton } from './Payments';
import { QueryView } from '../components/QueryView';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/Misc';
import { EmptyState } from '../components/ui/States';
import { useI18n } from '../i18n';
import { cn } from '../lib/cn';
import { formatDateTime, formatRelative } from '../lib/format';
import { useNow } from '../lib/useNow';

const ACTOR: Record<ActorType, { icon: LucideIcon; cls: string }> = {
  User: { icon: UserRound, cls: 'bg-info-soft text-info' },
  Agent: { icon: Bot, cls: 'bg-accent-soft text-accent-strong' },
  System: { icon: Cog, cls: 'bg-surface-2 text-muted' },
};

/** Groups entries by local calendar day for the timeline headings. */
function groupByDay(entries: AuditEntry[], locale: string): { day: string; items: AuditEntry[] }[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const groups: { day: string; items: AuditEntry[] }[] = [];
  for (const e of entries) {
    const day = fmt.format(new Date(e.at));
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }
  return groups;
}

export function AuditPage() {
  const { t, locale } = useI18n();
  const query = useAudit(100);
  const now = useNow();
  return (
    <>
      <PageHeader title={t('audit.title')} description={t('audit.subtitle')} actions={<ExportCsvButton />} />
      <QueryView query={query}>
        {(entries) =>
          entries.length === 0 ? (
            <Card>
              <EmptyState icon={ScrollText} title={t('audit.empty')} description={t('audit.emptyBody')} />
            </Card>
          ) : (
            <div className="space-y-6">
              {groupByDay(entries, locale).map((g) => (
                <section key={g.day} aria-label={g.day}>
                  <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">{g.day}</h2>
                  <ol className="relative space-y-4 border-l border-border pl-6">
                    {g.items.map((e) => {
                      const a = ACTOR[e.actorType];
                      const Icon = a.icon;
                      return (
                        <li key={e.id} className="relative" data-testid="audit-entry" data-actor-type={e.actorType}>
                          <span
                            className={cn('absolute top-0 -left-[38px] flex size-7 items-center justify-center rounded-full ring-4 ring-bg', a.cls)}
                            aria-hidden
                          >
                            <Icon className="size-3.5" />
                          </span>
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-sm font-medium">{e.actor}</span>
                            <span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-muted">{t(`actor.${e.actorType}`)}</span>
                            <span className="num text-xs text-muted">{e.action}</span>
                            <time dateTime={e.at} title={formatDateTime(e.at, locale)} className="ml-auto text-xs text-muted">
                              {formatRelative(e.at, now, locale)}
                            </time>
                          </div>
                          <p className="mt-1 text-sm break-words">{e.summary}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            {e.entityType}
                            {e.entityId ? (
                              <>
                                {' · '}
                                <span className="num">{e.entityId.length > 12 ? `${e.entityId.slice(0, 8)}…` : e.entityId}</span>
                              </>
                            ) : null}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
            </div>
          )
        }
      </QueryView>
    </>
  );
}
