import { Loader2, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
export type ButtonSize = 'sm' | 'md' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-strong text-on-accent hover:brightness-110 border border-transparent shadow-sm',
  secondary: 'bg-surface text-fg border border-border hover:bg-surface-2',
  ghost: 'bg-transparent text-fg border border-transparent hover:bg-surface-2',
  danger: 'bg-danger text-white dark:text-[#1a0606] border border-transparent hover:brightness-110',
  'danger-soft': 'bg-danger-soft text-danger border border-danger/30 hover:brightness-95 dark:hover:brightness-125',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 pointer-fine:min-h-8 px-3 text-sm gap-1.5',
  md: 'min-h-11 pointer-fine:min-h-9 px-4 text-base gap-2',
  icon: 'size-11 pointer-fine:size-9 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export const buttonClasses = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string) =>
  cn(
    'inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap',
    'transition-[filter,background-color,color] duration-150 select-none',
    'disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed',
    VARIANTS[variant],
    SIZES[size],
    extra,
  );

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  className,
  children,
  type = 'button',
  disabled,
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Loader2 aria-hidden className="size-4 animate-spin" />
      ) : Icon ? (
        <Icon aria-hidden className="size-4" />
      ) : null}
      {children}
    </button>
  );
}
