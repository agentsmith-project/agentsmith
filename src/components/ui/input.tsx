import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'prompt';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = 'default', ...props }, ref) => {
    const promptStyle =
      variant === 'prompt'
        ? 'rounded-pill border border-border/60 bg-surface-low px-5 py-3 text-foreground shadow-ambient hover:border-border focus:border-accent/40'
        : 'rounded-md border border-border-input/70 bg-input px-3 py-2.5 text-foreground shadow-[inset_0_1px_0_rgb(var(--bg-surface-low)/0.75)]';

    return (
      <input
        type={type}
        className={cn(
          'flex w-full transition-[border-color,background-color,box-shadow,color] duration-150',
          'focus:outline-none focus:ring-2 focus:ring-accent/25 focus-visible:ring-2 focus-visible:ring-accent/25 focus:border-accent/40',
          'placeholder:text-tertiary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          promptStyle,
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
