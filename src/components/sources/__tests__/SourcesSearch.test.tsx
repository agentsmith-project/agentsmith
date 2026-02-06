/**
 * Unit tests for SourcesSearch component
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';

import { SourcesSearch } from '../SourcesSearch';

describe('SourcesSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultProps = {
    value: '',
    onChange: vi.fn(),
  };

  it('should render search input with icon', () => {
    render(<SourcesSearch {...defaultProps} />);

    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'Search files...');
  });

  it('should render with custom placeholder', () => {
    render(<SourcesSearch {...defaultProps} placeholder="Custom placeholder" />);

    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument();
  });

  it('should display current value', () => {
    render(<SourcesSearch {...defaultProps} value="test search" />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('test search');
  });

  it('should update input value on user input', async () => {
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();

    render(<SourcesSearch {...defaultProps} onChange={onChange} />);

    const input = screen.getByRole('textbox');

    await user.type(input, 'test');

    expect(input).toHaveValue('test');
  });

  it('should debounce onChange callback', async () => {
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();

    render(<SourcesSearch {...defaultProps} onChange={onChange} />);

    const input = screen.getByRole('textbox');

    await user.type(input, 'test');

    // onChange should not be called immediately
    expect(onChange).not.toHaveBeenCalled();

    // Fast-forward 300ms (debounce time)
    vi.advanceTimersByTime(300);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('test');
    });
  });

  it('should not call onChange if value changes within debounce period', async () => {
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();

    render(<SourcesSearch {...defaultProps} onChange={onChange} />);

    const input = screen.getByRole('textbox');

    await user.type(input, 't');

    vi.advanceTimersByTime(200);

    await user.type(input, 'est');

    vi.advanceTimersByTime(300);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('test');
    });
  });

  it('should sync external value changes', async () => {
    const _user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();

    const { rerender } = render(
      <SourcesSearch {...defaultProps} value="initial" onChange={onChange} />
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('initial');

    // Change external value
    rerender(<SourcesSearch {...defaultProps} value="updated" onChange={onChange} />);

    await waitFor(() => {
      expect(input.value).toBe('updated');
    });
  });

  it('should show clear button when value is not empty', () => {
    render(<SourcesSearch {...defaultProps} value="test" />);

    const clearButton = screen.getByRole('button');
    expect(clearButton).toBeInTheDocument();
  });

  it('should not show clear button when value is empty', () => {
    render(<SourcesSearch {...defaultProps} value="" />);

    const clearButton = screen.queryByRole('button');
    expect(clearButton).not.toBeInTheDocument();
  });

  it('should clear value and call onChange when clear button is clicked', async () => {
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();

    render(<SourcesSearch {...defaultProps} value="test" onChange={onChange} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    const clearButton = screen.getByRole('button');

    await user.click(clearButton);

    expect(input.value).toBe('');
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('should have proper positioning for search icon', () => {
    const { container } = render(<SourcesSearch {...defaultProps} />);

    const searchIcon = container.querySelector('svg');
    expect(searchIcon).toBeInTheDocument();
    expect(searchIcon).toHaveClass('absolute', 'left-3');
  });

  it('should have proper positioning for clear button', () => {
    const { container } = render(<SourcesSearch {...defaultProps} value="test" />);

    const clearButton = container.querySelector('button');
    expect(clearButton).toHaveClass('absolute', 'right-3');
  });

  it('should apply custom className', () => {
    const { container } = render(
      <SourcesSearch {...defaultProps} className="custom-class" />
    );

    const wrapper = container.querySelector('.custom-class');
    expect(wrapper).toBeInTheDocument();
  });

  it('should have proper padding for input with icons', () => {
    const { container } = render(<SourcesSearch {...defaultProps} />);

    const input = container.querySelector('input');
    expect(input).toHaveClass('pl-9', 'pr-9');
  });

  it('should handle rapid input changes correctly', async () => {
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();

    render(<SourcesSearch {...defaultProps} onChange={onChange} />);

    const input = screen.getByRole('textbox');

    await user.type(input, 'a');
    await user.type(input, 'b');
    await user.type(input, 'c');

    vi.advanceTimersByTime(300);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('abc');
    });
  });

  it('should reset debounce timer on new input', async () => {
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const onChange = vi.fn();

    render(<SourcesSearch {...defaultProps} onChange={onChange} />);

    const input = screen.getByRole('textbox');

    await user.type(input, 'a');

    vi.advanceTimersByTime(200);

    await user.type(input, 'b');

    vi.advanceTimersByTime(200);

    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('ab');
    });
  });
});
