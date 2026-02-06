import React from 'react';

type PageLayoutProps = {
  header?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function PageLayout({ header, toolbar, children, footer }: PageLayoutProps) {
  return (
    <div data-testid="page-layout" className="h-full flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col px-6 py-6 gap-6">
        {header ? <div data-testid="page-layout__header">{header}</div> : null}
        {toolbar ? <div data-testid="page-layout__toolbar">{toolbar}</div> : null}
        <div data-testid="page-layout__body" className="flex-1 min-h-0 flex flex-col gap-6">
          {children}
        </div>
      </div>
      {footer ? (
        <div data-testid="page-layout__footer" className="px-6 pb-6">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
