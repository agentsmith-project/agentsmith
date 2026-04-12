import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-[13px] font-normal leading-none tracking-[0.01em] transition-[color,background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-border/80 bg-surface-high text-foreground shadow-ambient hover:border-border hover:bg-surface hover:text-accent',
        primary: 'border-transparent bg-accent text-white shadow-[0_18px_36px_rgba(245,78,0,0.24)] hover:-translate-y-[1px] hover:bg-accent/90',
        action: 'border-border bg-surface text-foreground shadow-ambient hover:bg-surface-high hover:text-accent',
        outline: 'border-border/70 bg-transparent text-primary hover:bg-surface-low hover:text-foreground',
        secondary: 'border-border/60 bg-surface-low text-primary hover:border-border hover:bg-surface hover:text-foreground',
        ghost: 'border-transparent bg-transparent text-secondary hover:bg-surface-low hover:text-foreground',
        link: 'border-transparent bg-transparent px-0 text-accent hover:text-error',
        destructive: 'border-error/25 bg-error/10 text-error hover:bg-error/15',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-9 px-3.5 text-[12px]',
        lg: 'h-11 px-5 text-sm',
        icon: 'h-10 w-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={buttonVariants({ variant, size, className })}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
