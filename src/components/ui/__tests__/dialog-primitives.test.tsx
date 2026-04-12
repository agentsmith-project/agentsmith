import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  dialogDescriptionClassName,
  dialogOverlayClassName,
} from '../dialog';
import {
  alertDialogDescriptionClassName,
  alertDialogOverlayClassName,
} from '../alert-dialog';
import { sheetDescriptionClassName, sheetOverlayClassName } from '../sheet';

describe('dialog primitives', () => {
  it('shares overlay and description styling across dialog primitives', () => {
    expect(dialogOverlayClassName).toBe(alertDialogOverlayClassName);
    expect(dialogOverlayClassName).toBe(sheetOverlayClassName);
    expect(dialogDescriptionClassName).toBe(alertDialogDescriptionClassName);
    expect(dialogDescriptionClassName).toBe(sheetDescriptionClassName);
    expect(dialogOverlayClassName).toContain('--overlay-scrim');
    expect(dialogOverlayClassName).not.toContain('dark:bg-');
    expect(dialogOverlayClassName).toContain('backdrop-blur-[1px]');
  });

  it('renders readable description copy in the base dialog', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Helper copy</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByText('Helper copy')).toHaveClass('text-sm');
    expect(screen.getByText('Helper copy')).toHaveClass('leading-6');
    expect(screen.getByText('Helper copy')).toHaveClass('text-secondary');
  });
});
