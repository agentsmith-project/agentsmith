import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  ProjectWorkbenchBar,
  ProjectWorkbenchSwitcher,
  type ProjectWorkbenchNavItem,
} from '@/components/layout/ProjectWorkbenchBar';

describe('ProjectWorkbenchBar', () => {
  const items: ProjectWorkbenchNavItem[] = [
    { href: '/one', label: 'One', testId: 'workbench__one', active: true },
    { href: '/two', label: 'Two', testId: 'workbench__two' },
  ];

  it('keeps the shell quiet instead of card-like', () => {
    render(<ProjectWorkbenchBar title="Project" />);

    const shell = screen.getByTestId('project-workbench');

    expect(shell.className).toContain('border-b');
    expect(shell.className).not.toMatch(/rounded-|shadow-/);
  });

  it('renders a compact segmented switcher without pill chrome', () => {
    const { container } = render(<ProjectWorkbenchSwitcher items={items} />);

    const switcher = container.firstElementChild as HTMLElement;

    expect(switcher.className).toContain('border');
    expect(switcher.className).not.toMatch(/rounded-full|shadow-/);
    expect(screen.getByTestId('workbench__one')).toHaveAttribute('aria-current', 'page');
  });
});
