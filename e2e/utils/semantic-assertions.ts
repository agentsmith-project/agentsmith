import { expect, type Page } from '@playwright/test';
import type { VisualBaselineSemanticAssertions } from '../visual-baseline-support';

export interface ViewportBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export type ProminentActionLimit = {
  scenarioId: string;
  prominentActionCount: number;
  maxProminentActions: number | null;
};

export type ProminentActionCandidate = {
  label: string;
  isInteractive: boolean;
  isMarkedPrimary: boolean;
  tagName: string;
  role: string | null;
  inputType: string | null;
  ariaChecked?: string | null;
  box: ViewportBox | null;
  viewport: ViewportSize | null;
  backgroundColor: string;
  color: string;
  rootBackgroundColor: string;
  opacity: number;
  pointerEvents: string;
  display: string;
  visibility: string;
};

type RgbaColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export type ProminentActionCandidateSummary = {
  prominentActionCount: number;
  unmarkedProminentActions: readonly ProminentActionCandidate[];
};

export function assertViewerLocalDateTimeMetadata(args: {
  testId: string;
  dateTime: string | null;
  policy: string | null;
}) {
  if (typeof args.dateTime !== 'string' || args.dateTime.trim().length === 0) {
    throw new Error(
      `visual semantic contract requires machine-readable dateTime metadata for viewer-local datetime target: ${args.testId}`,
    );
  }
  if (args.policy !== 'viewer_local') {
    throw new Error(
      `visual semantic contract requires viewer_local policy for viewer-local datetime target: ${args.testId}`,
    );
  }
}

function assertViewportCondition(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertViewportBoxFits(
  testId: string,
  box: ViewportBox | null,
  viewport: ViewportSize | null,
) {
  assertViewportCondition(box !== null, `visual semantic contract requires a layout box for viewport target: ${testId}`);
  assertViewportCondition(viewport !== null, `visual semantic contract requires viewport size for target: ${testId}`);
  const resolvedBox = box;
  const resolvedViewport = viewport;

  assertViewportCondition(resolvedBox.width > 0, `visual semantic contract requires non-zero width: ${testId}`);
  assertViewportCondition(resolvedBox.height > 0, `visual semantic contract requires non-zero height: ${testId}`);
  assertViewportCondition(resolvedBox.x >= 0, `visual semantic contract requires ${testId} to start inside the viewport`);
  assertViewportCondition(resolvedBox.y >= 0, `visual semantic contract requires ${testId} to start inside the viewport`);
  assertViewportCondition(
    resolvedBox.x + resolvedBox.width <= resolvedViewport.width,
    `visual semantic contract requires ${testId} to fit inside the viewport width`,
  );
  assertViewportCondition(
    resolvedBox.y + resolvedBox.height <= resolvedViewport.height,
    `visual semantic contract requires ${testId} to fit inside the viewport height`,
  );
}

function viewportBoxFits(box: ViewportBox | null, viewport: ViewportSize | null): boolean {
  return Boolean(
    box
    && viewport
    && box.width > 0
    && box.height > 0
    && box.x >= 0
    && box.y >= 0
    && box.x + box.width <= viewport.width
    && box.y + box.height <= viewport.height,
  );
}

function parseCssRgb(value: string): RgbaColor | null {
  const match = value.trim().match(/^rgba?\((.*)\)$/i);
  if (!match) {
    return null;
  }

  const parts = match[1]
    .replace(/\//g, ' ')
    .split(/[,\s]+/)
    .filter(Boolean);
  if (parts.length < 3) {
    return null;
  }

  const parseChannel = (part: string): number => {
    if (part.endsWith('%')) {
      return Math.round((Number.parseFloat(part) / 100) * 255);
    }
    return Number.parseFloat(part);
  };
  const parseAlpha = (part: string | undefined): number => {
    if (part === undefined) {
      return 1;
    }
    if (part.endsWith('%')) {
      return Number.parseFloat(part) / 100;
    }
    return Number.parseFloat(part);
  };

  const r = parseChannel(parts[0] ?? '');
  const g = parseChannel(parts[1] ?? '');
  const b = parseChannel(parts[2] ?? '');
  const a = parseAlpha(parts[3]);

  if ([r, g, b, a].some((part) => Number.isNaN(part))) {
    return null;
  }
  return {
    r: Math.min(255, Math.max(0, r)),
    g: Math.min(255, Math.max(0, g)),
    b: Math.min(255, Math.max(0, b)),
    a: Math.min(1, Math.max(0, a)),
  };
}

function channelToLinear(value: number): number {
  const normalized = value / 255;
  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: RgbaColor): number {
  return (0.2126 * channelToLinear(color.r))
    + (0.7152 * channelToLinear(color.g))
    + (0.0722 * channelToLinear(color.b));
}

function contrastRatio(left: RgbaColor, right: RgbaColor): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function visibleInteractiveCandidate(candidate: ProminentActionCandidate): boolean {
  return candidate.isInteractive
    && viewportBoxFits(candidate.box, candidate.viewport)
    && candidate.opacity >= 0.75
    && candidate.pointerEvents !== 'none'
    && candidate.display !== 'none'
    && candidate.visibility !== 'hidden';
}

function isSelectionControlCandidate(candidate: ProminentActionCandidate): boolean {
  const role = candidate.role?.toLowerCase() ?? null;
  const inputType = candidate.inputType?.toLowerCase() ?? null;
  const selectionRoles = new Set(['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio']);

  return selectionRoles.has(role ?? '')
    || inputType === 'checkbox'
    || inputType === 'radio'
    || (
      candidate.ariaChecked !== null
      && candidate.ariaChecked !== undefined
      && selectionRoles.has(role ?? '')
    );
}

function isStrongFilledAction(candidate: ProminentActionCandidate): boolean {
  if (!visibleInteractiveCandidate(candidate)) {
    return false;
  }

  const background = parseCssRgb(candidate.backgroundColor);
  const foreground = parseCssRgb(candidate.color);
  const rootBackground = parseCssRgb(candidate.rootBackgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
  if (!background || !foreground || background.a < 0.85) {
    return false;
  }

  return contrastRatio(background, foreground) >= 3
    && contrastRatio(background, rootBackground) >= 2.4;
}

function isProminentActionCandidate(candidate: ProminentActionCandidate): boolean {
  return visibleInteractiveCandidate(candidate)
    && !isSelectionControlCandidate(candidate)
    && (candidate.isMarkedPrimary || isStrongFilledAction(candidate));
}

export function summarizeProminentActionCandidates(
  candidates: readonly ProminentActionCandidate[],
): ProminentActionCandidateSummary {
  const prominentActions = candidates.filter(isProminentActionCandidate);
  return {
    prominentActionCount: prominentActions.length,
    unmarkedProminentActions: prominentActions.filter((candidate) => !candidate.isMarkedPrimary),
  };
}

function formatProminentActionCandidate(candidate: ProminentActionCandidate): string {
  const parts = [candidate.tagName];
  if (candidate.role) {
    parts.push(`[role=${candidate.role}]`);
  }
  if (candidate.inputType) {
    parts.push(`[type=${candidate.inputType}]`);
  }
  return candidate.label || parts.join('');
}

export function assertProminentActionsUseDesignSystemMetadata(args: {
  scenarioId: string;
  candidates: readonly ProminentActionCandidate[];
}) {
  const summary = summarizeProminentActionCandidates(args.candidates);
  if (summary.unmarkedProminentActions.length === 0) {
    return;
  }

  throw new Error(
    `visual semantic contract for ${args.scenarioId} found visually prominent action(s) without design-system prominence metadata: ${
      summary.unmarkedProminentActions.map(formatProminentActionCandidate).join(', ')
    }. Use Button variant="primary" or Button asChild variant="primary" instead of custom primary styles.`,
  );
}

export function assertProminentActionCountFits({
  scenarioId,
  prominentActionCount,
  maxProminentActions,
}: ProminentActionLimit) {
  if (maxProminentActions === null) {
    return;
  }
  assertViewportCondition(
    prominentActionCount <= maxProminentActions,
    `visual semantic contract for ${scenarioId} allows at most ${maxProminentActions} prominent action(s), found ${prominentActionCount}`,
  );
}

async function collectProminentActionCandidates(page: Page): Promise<ProminentActionCandidate[]> {
  return page.locator('button, a[href], [role="button"], input[type="button"], input[type="submit"]').evaluateAll((elements) => {
    const bodyStyle = window.getComputedStyle(document.body);
    const htmlStyle = window.getComputedStyle(document.documentElement);
    const rootBackgroundColor = bodyStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
      ? htmlStyle.backgroundColor
      : bodyStyle.backgroundColor;
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    return elements.map((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const elementWithText = element as HTMLElement;
      const inputType = element instanceof HTMLInputElement ? element.type : null;
      const label = element.getAttribute('data-testid')
        ?? element.getAttribute('aria-label')
        ?? elementWithText.innerText?.replace(/\s+/g, ' ').trim()
        ?? element.tagName.toLowerCase();
      const disabled = element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true';

      return {
        label,
        isInteractive: !disabled,
        isMarkedPrimary: element.getAttribute('data-visual-prominence') === 'primary',
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        inputType,
        ariaChecked: element.getAttribute('aria-checked'),
        box: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        viewport,
        backgroundColor: style.backgroundColor,
        color: style.color,
        rootBackgroundColor,
        opacity: Number.parseFloat(style.opacity || '1'),
        pointerEvents: style.pointerEvents,
        display: style.display,
        visibility: style.visibility,
      };
    });
  });
}

export async function expectVisualSemanticAssertions(
  page: Page,
  assertions: VisualBaselineSemanticAssertions,
  scenarioId = 'visual scenario',
) {
  const body = page.locator('body');

  for (const text of assertions.forbiddenVisibleText) {
    await expect(
      body,
      `visual semantic contract forbids visible text: ${text}`,
    ).not.toContainText(text);
  }

  for (const pattern of assertions.forbiddenVisibleTextPatterns) {
    await expect(
      body,
      `visual semantic contract forbids visible text pattern: ${pattern}`,
    ).not.toContainText(new RegExp(pattern));
  }

  for (const testId of assertions.requiredViewportTestIds) {
    const locator = page.getByTestId(testId);
    await expect(locator, `visual semantic contract requires unique viewport target: ${testId}`).toHaveCount(1);
    await expect(locator, `visual semantic contract requires visible viewport target: ${testId}`).toBeVisible();

    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    assertViewportBoxFits(testId, box, viewport);
  }

  for (const testId of assertions.requiredViewerLocalDateTimeTestIds) {
    const locator = page.getByTestId(testId);
    const count = await locator.count();
    expect(
      count,
      `visual semantic contract requires at least one viewer-local datetime target: ${testId}`,
    ).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      await expect(
        item,
        `visual semantic contract requires visible viewer-local datetime target: ${testId} (match ${index + 1} of ${count})`,
      ).toBeVisible();

      const metadata = await item.evaluate((element) => ({
        dateTime: element instanceof HTMLTimeElement ? element.dateTime : element.getAttribute('datetime'),
        policy: element.getAttribute('data-visual-datetime-policy'),
      }));

      assertViewerLocalDateTimeMetadata({
        testId: `${testId} (match ${index + 1} of ${count})`,
        dateTime: metadata.dateTime,
        policy: metadata.policy,
      });
    }
  }

  for (const testId of assertions.primaryActionTestIds) {
    const locator = page.getByTestId(testId);
    await expect(locator, `visual semantic contract requires unique primary action: ${testId}`).toHaveCount(1);
    await expect(locator, `visual semantic contract requires visible primary action: ${testId}`).toBeVisible();
    await expect(locator, `visual semantic contract requires primary action prominence: ${testId}`)
      .toHaveAttribute('data-visual-prominence', 'primary');

    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    assertViewportBoxFits(testId, box, viewport);
  }

  const prominentActionCandidates = await collectProminentActionCandidates(page);
  assertProminentActionsUseDesignSystemMetadata({
    scenarioId,
    candidates: prominentActionCandidates,
  });
  assertProminentActionCountFits({
    scenarioId,
    prominentActionCount: summarizeProminentActionCandidates(prominentActionCandidates).prominentActionCount,
    maxProminentActions: assertions.maxProminentActions,
  });
}
