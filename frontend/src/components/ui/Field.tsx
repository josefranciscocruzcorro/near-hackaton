import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/cn';

export const controlClasses = cn(
  'block w-full rounded-lg border border-border bg-surface px-3 text-base text-fg placeholder:text-muted/80',
  'min-h-11 pointer-fine:min-h-9 transition-colors',
  'hover:border-muted/60 focus-visible:border-accent',
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted',
  'aria-invalid:border-danger',
);

interface FieldShellProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

/** Label + control + hint + error, wired for screen readers. */
export function FieldShell({ id, label, hint, error, required, children, className }: FieldShellProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-danger">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface BaseProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  containerClassName?: string;
}

export function TextField({
  label,
  hint,
  error,
  containerClassName,
  className,
  id: idProp,
  required,
  ref,
  ...rest
}: BaseProps & InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} className={containerClassName}>
      <input
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlClasses, className)}
        {...rest}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  containerClassName,
  className,
  id: idProp,
  required,
  children,
  ...rest
}: BaseProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} className={containerClassName}>
      <select
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlClasses, 'pr-8', className)}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function TextareaField({
  label,
  hint,
  error,
  containerClassName,
  className,
  id: idProp,
  required,
  ...rest
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} className={containerClassName}>
      <textarea
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(controlClasses, 'py-2 leading-relaxed', className)}
        {...rest}
      />
    </FieldShell>
  );
}

/** Checkbox rendered as a switch (native input keeps keyboard + form semantics). */
export function SwitchField({
  label,
  hint,
  id: idProp,
  className,
  ...rest
}: { label: ReactNode; hint?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-fg">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="mt-0.5 text-xs text-muted">
            {hint}
          </p>
        ) : null}
      </div>
      <span className="relative inline-flex h-11 w-12 shrink-0 items-center justify-center pointer-fine:h-7">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...rest}
        />
        <span
          aria-hidden
          className={cn(
            'relative h-6 w-11 rounded-full border border-border bg-surface-2 transition-colors',
            'peer-checked:border-accent peer-checked:bg-accent',
            'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
            'peer-disabled:opacity-50',
          )}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1 size-5 -translate-y-1/2 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
        />
      </span>
    </div>
  );
}
