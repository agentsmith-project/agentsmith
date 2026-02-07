import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-surface-high text-foreground border border-subtle hover:bg-hover",
        // Primary: solid accent for main CTA in dialogs (design doc 5.5)
        primary: "bg-accent text-white hover:bg-accent/90",
        // Action: neutral toolbar CTA for page-level "Create/New" actions (design system 5.3)
        action: "bg-hover border border-subtle text-foreground hover:bg-surface-high",
        outline: "border border-border bg-transparent text-primary hover:bg-hover hover:text-foreground",
        secondary: "bg-surface text-primary border border-subtle hover:bg-hover hover:text-foreground",
        // Ghost: text-only for Cancel in dialogs (design doc 5.5)
        ghost: "bg-transparent text-tertiary hover:text-primary hover:bg-transparent",
        link: "bg-transparent text-accent underline-offset-4 hover:underline",
        destructive: "bg-transparent text-error hover:bg-error/10",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3",
        lg: "h-11 px-6",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={buttonVariants({ variant, size, className })}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
