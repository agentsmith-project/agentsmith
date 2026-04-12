import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'prompt';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = 'default', ...props }, ref) => {
    const promptStyle =
      variant === 'prompt'
        ? 'rounded-pill border border-border/55 bg-surface-low px-4 py-2.5 text-foreground hover:border-border/75 focus:border-border'
        : 'rounded-md border border-border-input/65 bg-input px-3 py-2.5 text-foreground hover:border-border/80 focus:border-border';

    return (
      <input
        type={type}
        className={cn(
          'flex w-full transition-[border-color,background-color,box-shadow,color] duration-150',
          'focus:outline-none focus:ring-2 focus:ring-accent/18 focus-visible:ring-2 focus-visible:ring-accent/18',
          'placeholder:text-tertiary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          promptStyle,
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
