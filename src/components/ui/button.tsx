import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-[13px] font-normal leading-none tracking-[0.005em] transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-border/24 bg-transparent text-secondary hover:border-border/30 hover:bg-surface-low/305 hover:text-foreground',
        primary: 'border-transparent bg-foreground/94 text-background hover:bg-foreground hover:text-background',
        action: 'border-border/24 bg-surface-low/35 text-foreground hover:border-border/30 hover:bg-surface-low/505 hover:text-foreground',
        outline: 'border-border/24 bg-transparent text-secondary hover:border-border/32 hover:bg-surface-low/30 hover:text-foreground',
        secondary: 'border-transparent bg-surface-low/35 text-secondary hover:bg-surface-low/50 hover:text-foreground',
        ghost: 'border-transparent bg-transparent text-secondary hover:bg-surface-low/25 hover:text-foreground',
        link: 'border-transparent bg-transparent px-0 text-secondary hover:text-foreground',
        destructive: 'border-error/18 bg-error/6 text-error hover:bg-error/10',
      },
      size: {
        default: 'h-9 px-3.5',
        sm: 'h-8 px-3 text-[12px]',
        lg: 'h-10 px-4 text-[13px]',
        icon: 'h-9 w-9 p-0',
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
