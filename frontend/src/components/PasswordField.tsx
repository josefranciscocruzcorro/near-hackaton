import { Check, Copy, Eye, EyeOff, WandSparkles } from 'lucide-react';
import { useEffect, useId, useState, type InputHTMLAttributes } from 'react';
import { MIN_PASSWORD_LENGTH } from '../api/types';
import { useI18n } from '../i18n';
import { cn } from '../lib/cn';
import { generatePassword, passwordStrength, type PasswordStrength } from '../lib/password';
import { controlClasses, describedBy, FieldShell } from './ui/Field';

const STRENGTH_TONE: Record<PasswordStrength, string> = {
  tooShort: 'text-muted',
  weak: 'text-danger',
  fair: 'text-warning',
  strong: 'text-accent-strong',
};
const STRENGTH_BARS: Record<PasswordStrength, number> = { tooShort: 0, weak: 1, fair: 2, strong: 3 };
const BAR_TONE: Record<PasswordStrength, string> = {
  tooShort: 'bg-border',
  weak: 'bg-danger',
  fair: 'bg-warning',
  strong: 'bg-accent',
};

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  error?: string | null;
  /** Shows the ≥12 characters strength hint (new passwords). */
  showStrength?: boolean;
  /** Adds "Generate" + "Copy" buttons (temporary passwords set by an Owner). */
  generator?: boolean;
  containerClassName?: string;
  testId?: string;
}

const iconBtn =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:bg-surface-2 hover:text-fg pointer-fine:size-9';

/** Password input with show/hide, optional strength hint and optional strong-password generator. */
export function PasswordField({
  label,
  value,
  onValueChange,
  error,
  showStrength = false,
  generator = false,
  containerClassName,
  testId,
  id: idProp,
  required,
  ...rest
}: PasswordFieldProps) {
  const { t } = useI18n();
  const auto = useId();
  const id = idProp ?? auto;
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const strength = passwordStrength(value);
  const hint = showStrength ? (
    <span className="flex flex-col gap-1" aria-live="polite" data-testid={testId ? `${testId}-strength` : undefined} data-strength={value ? strength : undefined}>
      <span aria-hidden className="flex gap-1">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full', value && STRENGTH_BARS[strength] >= i ? BAR_TONE[strength] : 'bg-surface-2')} />
        ))}
      </span>
      <span className={cn(value ? STRENGTH_TONE[strength] : 'text-muted')}>
        {value ? t(`password.strength.${strength}`, { min: MIN_PASSWORD_LENGTH }) : t('password.minHint', { min: MIN_PASSWORD_LENGTH })}
      </span>
    </span>
  ) : undefined;

  const generate = () => {
    onValueChange(generatePassword());
    setRevealed(true);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} className={containerClassName}>
      <div className="flex gap-1.5">
        <input
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(controlClasses, 'num min-w-0 flex-1')}
          spellCheck={false}
          autoCapitalize="off"
          data-testid={testId}
          {...rest}
        />
        <button
          type="button"
          className={iconBtn}
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? t('password.hide') : t('password.show')}
          aria-pressed={revealed}
          aria-controls={id}
        >
          {revealed ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </button>
        {generator ? (
          <>
            <button
              type="button"
              className={iconBtn}
              onClick={generate}
              aria-label={t('password.generate')}
              title={t('password.generate')}
              data-testid={testId ? `${testId}-generate` : undefined}
            >
              <WandSparkles aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              className={iconBtn}
              onClick={() => void copy()}
              disabled={!value}
              aria-label={copied ? t('common.copied') : t('password.copy')}
              title={t('password.copy')}
              data-testid={testId ? `${testId}-copy` : undefined}
            >
              {copied ? <Check aria-hidden className="size-4 text-accent-strong" /> : <Copy aria-hidden className="size-4" />}
            </button>
          </>
        ) : null}
      </div>
    </FieldShell>
  );
}
