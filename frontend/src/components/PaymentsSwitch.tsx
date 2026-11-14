import { CirclePause, CirclePlay, OctagonX, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { usePaymentsSwitch, usePolicy } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import { ConfirmDialog } from './ConfirmDialog';
import { GuardedButton } from './GuardedButton';
import type { ButtonSize } from './ui/Button';
import { useToast } from './ui/Toast';

/** True when every payment is stopped (`agentEnabled` off); null while the policy loads. */
export function usePaymentsStopped(): boolean | null {
  const { data } = usePolicy();
  return data ? !data.agentEnabled : null;
}

function useSwitch() {
  const { t } = useI18n();
  const { toast } = useToast();
  const mutation = usePaymentsSwitch();
  const run = (action: 'stop' | 'resume', done: () => void) =>
    mutation.mutate(action, {
      onSuccess: () => {
        done();
        toast(
          action === 'stop'
            ? { title: t('stop.done'), description: t('stop.doneBody'), tone: 'warning', duration: 8000 }
            : { title: t('resume.done'), description: t('resume.doneBody'), tone: 'success' },
        );
      },
      onError: (err) => toast({ title: action === 'stop' ? t('stop.failed') : t('resume.failed'), description: err.message, tone: 'error' }),
    });
  return { run, pending: mutation.isPending };
}

/** The dialog that asks before stopping or resuming every payment. */
function SwitchDialog({ action, onClose }: { action: 'stop' | 'resume' | null; onClose: () => void }) {
  const { t } = useI18n();
  const { run, pending } = useSwitch();
  if (action === null) return null;
  return action === 'stop' ? (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => run('stop', onClose)}
      title={t('stop.confirmTitle')}
      confirmLabel={t('stop.confirm')}
      icon={OctagonX}
      variant="danger"
      loading={pending}
      testId="stop-payments-dialog"
    >
      <p className="font-medium">{t('stop.confirmBody')}</p>
      <p className="text-muted">{t('stop.confirmDetail')}</p>
    </ConfirmDialog>
  ) : (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => run('resume', onClose)}
      title={t('resume.confirmTitle')}
      confirmLabel={t('resume.confirm')}
      icon={CirclePlay}
      loading={pending}
      testId="resume-payments-dialog"
    >
      <p>{t('resume.confirmBody')}</p>
    </ConfirmDialog>
  );
}

/**
 * Big red "Stop all payments" (or "Resume payments" once stopped). Owner only; others see it
 * disabled with the reason. Renders nothing until the policy is known.
 */
export function PaymentsSwitchButton({ size = 'md', hideWhenStopped = false, className }: { size?: ButtonSize; hideWhenStopped?: boolean; className?: string }) {
  const { t } = useI18n();
  const stopped = usePaymentsStopped();
  const [dialog, setDialog] = useState<'stop' | 'resume' | null>(null);
  if (stopped === null || (stopped && hideWhenStopped)) return null;
  return (
    <>
      {stopped ? (
        <GuardedButton permission="policy.edit" variant="primary" size={size} icon={CirclePlay} onClick={() => setDialog('resume')} className={className} data-testid="resume-payments-button">
          {t('resume.button')}
        </GuardedButton>
      ) : (
        <GuardedButton permission="policy.edit" variant="danger" size={size} icon={OctagonX} onClick={() => setDialog('stop')} className={className} data-testid="stop-payments-button">
          {t('stop.button')}
        </GuardedButton>
      )}
      <SwitchDialog action={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

/** The red app-wide notice (payments stopped, treasury frozen): icon, bold title, body, action. */
export function DangerBanner({ icon: Icon, title, body, action, testId }: { icon: LucideIcon; title: string; body: string; action: ReactNode; testId: string }) {
  return (
    <div role="status" data-testid={testId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-danger/40 bg-danger-soft px-4 py-2 text-sm lg:px-6">
      <Icon aria-hidden className="size-5 shrink-0 text-danger" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold text-danger">{title}</span> <span className="text-fg/90">{body}</span>
      </p>
      {action}
    </div>
  );
}

/** App-wide notice while payments are stopped, with "Resume" for Owners. */
export function PaymentsStoppedBanner() {
  const { t } = useI18n();
  const { can } = useAuth();
  const stopped = usePaymentsStopped();
  const [dialog, setDialog] = useState<'resume' | null>(null);
  if (!stopped) return null;
  return (
    <DangerBanner
      icon={CirclePause}
      title={t('stop.bannerTitle')}
      body={t('stop.bannerBody')}
      testId="payments-stopped-banner"
      action={
        <>
          {can('policy.edit') ? (
            <GuardedButton permission="policy.edit" size="sm" variant="primary" icon={CirclePlay} onClick={() => setDialog('resume')} className="shrink-0" data-testid="banner-resume-button">
              {t('resume.button')}
            </GuardedButton>
          ) : (
            <span className="text-xs text-muted">{t('stop.bannerAskOwner')}</span>
          )}
          <SwitchDialog action={dialog} onClose={() => setDialog(null)} />
        </>
      }
    />
  );
}
