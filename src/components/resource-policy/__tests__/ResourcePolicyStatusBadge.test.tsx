import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResourcePolicyStatusBadge } from '../ResourcePolicyStatusBadge';

describe('ResourcePolicyStatusBadge', () => {
  it('renders label, title, and aria-label', () => {
    render(
      <ResourcePolicyStatusBadge
        status="allow_list"
        label="Allow list"
        title="Only selected users/groups can access this resource."
      />
    );

    const badge = screen.getByText('Allow list');
    expect(badge).toHaveAttribute('title', 'Only selected users/groups can access this resource.');
    expect(badge).toHaveAttribute(
      'aria-label',
      'Allow list. Only selected users/groups can access this resource.'
    );
  });

  it('applies status-specific classes', () => {
    const { rerender } = render(
      <ResourcePolicyStatusBadge status="default" label="Default" title="Default state" />
    );
    expect(screen.getByText('Default')).toHaveClass('border-subtle', 'text-tertiary');

    rerender(<ResourcePolicyStatusBadge status="overridden" label="Overridden" title="Overridden" />);
    expect(screen.getByText('Overridden')).toHaveClass('border-subtle', 'text-foreground');

    rerender(<ResourcePolicyStatusBadge status="allow_list" label="Allow list" title="Allow list" />);
    expect(screen.getByText('Allow list')).toHaveClass('border-[rgb(var(--accent))]', 'text-primary');

    rerender(<ResourcePolicyStatusBadge status="loading" label="Checking..." title="Loading" />);
    expect(screen.getByText('Checking...')).toHaveClass('border-subtle', 'text-tertiary');
  });
});
