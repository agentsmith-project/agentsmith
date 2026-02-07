import React from 'react';

type PageLayoutProps = {
  header?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  density?: 'default' | 'immersive';
  contentWidth?: 'full' | 'wide' | 'narrow';
};

export function PageLayout({
  header,
  toolbar,
  children,
  footer,
  density = 'default',
  contentWidth = 'wide',
}: PageLayoutProps) {
  const chromeClass =
    density === 'immersive'
      ? 'px-[var(--layout-padding-immersive)] py-[var(--layout-padding-immersive)] gap-[var(--layout-gap-immersive)]'
      : 'px-[var(--layout-padding)] py-[var(--layout-padding)] gap-[var(--layout-gap)]';

  const bodyClass = density === 'immersive' ? 'gap-[var(--layout-gap-immersive)]' : 'gap-[var(--layout-gap)]';
  const footerClass = density === 'immersive' ? 'px-[var(--layout-padding-immersive)] pb-[var(--layout-padding-immersive)]' : 'px-[var(--layout-padding)] pb-[var(--layout-padding)]';
  const contentContainerClass =
    contentWidth === 'full'
      ? 'w-full'
      : contentWidth === 'narrow'
        ? 'w-full max-w-5xl mx-auto'
        : 'w-full max-w-[1600px] mx-auto';

  const bodyContentClass =
    contentWidth === 'full'
      ? 'w-full min-h-0 flex-1 flex flex-col'
      : contentWidth === 'narrow'
        ? 'w-full max-w-5xl mx-auto min-h-0 flex-1 flex flex-col'
        : 'w-full max-w-[1600px] mx-auto min-h-0 flex-1 flex flex-col';

  return (
    <div data-testid="page-layout" className="h-full flex flex-col">
      <div className={`flex-1 min-h-0 flex flex-col ${chromeClass}`}>
        {header ? (
          <div data-testid="page-layout__header">
            <div className={contentContainerClass}>{header}</div>
          </div>
        ) : null}
        {toolbar ? (
          <div data-testid="page-layout__toolbar">
            <div className={contentContainerClass}>{toolbar}</div>
          </div>
        ) : null}
        <div data-testid="page-layout__body" className={`flex-1 min-h-0 flex flex-col ${bodyClass}`}>
          <div className={bodyContentClass}>{children}</div>
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
