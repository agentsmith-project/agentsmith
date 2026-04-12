import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Logo } from '../Logo';

describe('Logo', () => {
  it('keeps the mark quiet without elevated chrome', () => {
    render(<Logo />);

    const mark = screen.getByTestId('logo__mark');
    expect(mark).toBeInTheDocument();
    expect(mark.className).not.toMatch(/shadow-/);
  });
});
