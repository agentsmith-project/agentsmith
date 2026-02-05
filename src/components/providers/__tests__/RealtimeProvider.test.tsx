import { render, screen } from '@testing-library/react';
import { RealtimeProvider } from '../RealtimeProvider';

test('renders children when disabled', () => {
  render(<RealtimeProvider mode="disabled">ok</RealtimeProvider>);
  expect(screen.getByText('ok')).toBeInTheDocument();
});
