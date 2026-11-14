import { Bot, ShieldHalf } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useRunAgent } from '../api/queries';
import type { AgentRunMode } from '../api/types';
import { useI18n } from '../i18n';
import { GuardedButton } from './GuardedButton';
import type { ButtonVariant } from './ui/Button';
import { useToast } from './ui/Toast';

/**
 * Owner-only: enqueue an agent run (or a red-team drill) and jump to its live detail, which polls
 * every 2 s until the run leaves `Running`.
 */
export function RunAgentButton({
  variant = 'primary',
  disabledReason,
  mode = 'Plan',
}: {
  variant?: ButtonVariant;
  disabledReason?: string | null;
  mode?: AgentRunMode;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { mutate, isPending } = useRunAgent();
  const drill = mode === 'RedTeamDrill';

  return (
    <GuardedButton
      permission="agent.run"
      blockedReason={disabledReason}
      variant={variant}
      icon={drill ? ShieldHalf : Bot}
      loading={isPending}
      data-testid={drill ? 'run-drill' : 'run-agent-button'}
      title={drill ? t('drill.explain') : undefined}
      onClick={() =>
        mutate(mode, {
          onSuccess: (run) => {
            toast({
              title: drill ? t('drill.started') : t('agent.started'),
              description: drill ? t('drill.startedBody') : t('agent.startedBody'),
              tone: 'success',
            });
            void navigate(`/agent/${run.id}`);
          },
          onError: (err) => toast({ title: t('agent.startFailed'), description: err.message, tone: 'error' }),
        })
      }
    >
      {drill ? t('drill.run') : t('agent.runNow')}
    </GuardedButton>
  );
}
