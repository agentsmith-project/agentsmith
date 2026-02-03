import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'prompt';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = 'default', ...props }, ref) => {
    const promptStyle =
      variant === 'prompt'
        ? "rounded-full px-6 py-3 bg-hover border border-subtle focus:border-accent"
        : "rounded-md px-3 py-2.5 bg-input border border-border-input text-foreground";

    return (
      <input
        type={type}
        className={cn(
          "flex w-full",
          "transition-colors duration-200",
          "focus:outline-none focus:ring-2 focus:ring-accent/50 focus-visible:ring-2 focus-visible:ring-accent/50 focus:border-accent/50",
          "placeholder:text-tertiary",
          "disabled:cursor-not-allowed disabled:opacity-50",
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
