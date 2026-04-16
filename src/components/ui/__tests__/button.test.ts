import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { Button, buttonVariants } from '@/components/ui/button';

const supportedTailwindOpacityTokens = new Set([
  '0',
  '5',
  '10',
  '15',
  '20',
  '25',
  '30',
  '35',
  '40',
  '45',
  '50',
  '55',
  '60',
  '65',
  '70',
  '75',
  '80',
  '85',
  '90',
  '95',
  '100',
]);

function collectUnsupportedOpacityClasses(className: string) {
  return className
    .split(/\s+/)
    .filter((token) => /^(?:[a-z-]+:)*(?:bg|border|text)-.+\/\d+$/.test(token))
    .filter((token) => {
      const opacity = token.match(/\/(\d+)$/)?.[1];
      return opacity ? !supportedTailwindOpacityTokens.has(opacity) : false;
    });
}

describe('buttonVariants', () => {
  it('keeps shared button color opacity tokens inside the Tailwind-supported scale', () => {
    const variants = ['default', 'primary', 'action', 'outline', 'secondary', 'ghost', 'link', 'destructive'] as const;
    const invalidClasses = variants.flatMap((variant) => collectUnsupportedOpacityClasses(buttonVariants({ variant })));

    expect(invalidClasses).toEqual([]);
  });

  it('uses an actual filled primary class so visual CTA checks do not rely on invisible text-only buttons', () => {
    expect(buttonVariants({ variant: 'primary' }).split(/\s+/)).toEqual(expect.arrayContaining([
      'bg-foreground',
      'text-background',
    ]));
  });

  it('exposes design-system prominence metadata for visual semantic CTA hierarchy checks', () => {
    render(
      createElement('div', null,
        createElement(Button, { type: 'button', variant: 'primary' }, 'Create'),
        createElement(Button, { type: 'button', variant: 'outline' }, 'Cancel'),
      ),
    );

    expect(screen.getByRole('button', { name: 'Create' })).toHaveAttribute('data-visual-prominence', 'primary');
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveAttribute('data-visual-prominence');
  });
});
