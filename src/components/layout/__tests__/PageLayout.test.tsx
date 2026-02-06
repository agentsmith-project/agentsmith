import { render, screen } from '@testing-library/react';
import { PageLayout } from '../PageLayout';

test('applies consistent chrome spacing', () => {
  const { container } = render(
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

  const chrome = container.querySelector('[data-testid="page-layout"] > div');
  expect(chrome).toHaveClass('px-[var(--layout-padding)]');
  expect(chrome).toHaveClass('py-[var(--layout-padding)]');
  expect(chrome).toHaveClass('gap-[var(--layout-gap)]');
});

test('supports immersive chrome spacing', () => {
  const { container } = render(
    <PageLayout density="immersive">
      <div>Body</div>
    </PageLayout>
  );

  const chrome = container.querySelector('[data-testid="page-layout"] > div');
  expect(chrome).toHaveClass('px-[var(--layout-padding-immersive)]');
  expect(chrome).toHaveClass('py-[var(--layout-padding-immersive)]');
  expect(chrome).toHaveClass('gap-[var(--layout-gap-immersive)]');
});
