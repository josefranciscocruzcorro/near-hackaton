import type { TFunction } from '../i18n';
import { daysUntil } from './format';

/** "Due today", "Due in 3 days", "Overdue by 2 days". */
export function dueLabel(t: TFunction, dueDate: string, now: Date = new Date()): { text: string; overdue: boolean; soon: boolean } {
  const days = daysUntil(dueDate, now);
  if (days < 0) return { text: t('due.overdue', { count: Math.abs(days) }), overdue: true, soon: true };
  if (days === 0) return { text: t('due.today'), overdue: false, soon: true };
  if (days === 1) return { text: t('due.tomorrow'), overdue: false, soon: true };
  return { text: t('due.inDays', { count: days }), overdue: false, soon: days <= 3 };
}
