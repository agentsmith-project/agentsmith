import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'default' | 'prompt';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = 'default', ...props }, ref) => {
    const promptStyle = variant === 'prompt'
      ? "rounded-3xl px-6 py-4 border-transparent focus:border-accent"
      : "rounded-md px-3 py-2";

    return (
      <input
        type={type}
        className={cn(
          "flex w-full bg-surface-high text-foreground",
          "border transition-all duration-200",
          "focus:outline-none focus:ring-2 focus:ring-accent/50",
          "placeholder:text-foreground-muted",
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
