import React from 'react';

type PageLayoutProps = {
  header?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  density?: 'default' | 'immersive';
};

export function PageLayout({ header, toolbar, children, footer, density = 'default' }: PageLayoutProps) {
  const chromeClass =
    density === 'immersive'
      ? 'px-[var(--layout-padding-immersive)] py-[var(--layout-padding-immersive)] gap-[var(--layout-gap-immersive)]'
      : 'px-[var(--layout-padding)] py-[var(--layout-padding)] gap-[var(--layout-gap)]';

  const bodyClass = density === 'immersive' ? 'gap-[var(--layout-gap-immersive)]' : 'gap-[var(--layout-gap)]';
  const footerClass = density === 'immersive' ? 'px-[var(--layout-padding-immersive)] pb-[var(--layout-padding-immersive)]' : 'px-[var(--layout-padding)] pb-[var(--layout-padding)]';

  return (
    <div data-testid="page-layout" className="h-full flex flex-col">
      <div className={`flex-1 min-h-0 flex flex-col ${chromeClass}`}>
        {header ? <div data-testid="page-layout__header">{header}</div> : null}
        {toolbar ? <div data-testid="page-layout__toolbar">{toolbar}</div> : null}
        <div data-testid="page-layout__body" className={`flex-1 min-h-0 flex flex-col ${bodyClass}`}>
          {children}
        </div>
      </div>
      {footer ? (
        <div data-testid="page-layout__footer" className={footerClass}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
