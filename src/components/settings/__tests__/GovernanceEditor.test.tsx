import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { GovernanceEditor } from '../GovernanceEditor';

describe('GovernanceEditor', () => {
  it('updates form fields', () => {
    const onChange = vi.fn();
    render(<GovernanceEditor value={{}} onChange={onChange} />);

    const rpmInput = screen.getByLabelText(/governance_form.max_rpm/);
    fireEvent.change(rpmInput, { target: { value: '120' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        rate_limit: { max_requests_per_minute: 120 },
      })
    );
  });
});
