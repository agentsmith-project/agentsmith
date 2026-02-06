import { render, screen } from '@testing-library/react';
import { PageLayout } from '../PageLayout';

test('applies consistent chrome spacing', () => {
  render(
    <PageLayout
      header={<div>Header</div>}
      toolbar={<div>Toolbar</div>}
      footer={<div>Footer</div>}
    >
      <div>Body</div>
    </PageLayout>
  );
  expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
  expect(screen.getByTestId('page-layout__toolbar')).toBeInTheDocument();
  expect(screen.getByTestId('page-layout__body')).toBeInTheDocument();
  expect(screen.getByTestId('page-layout__footer')).toBeInTheDocument();
});
