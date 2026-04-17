export type DisplayDateTimeOptions = {
  locale?: string;
  timeZone?: string;
  emptyText?: string;
  invalidText?: string;
};

export type ViewerLocalDateTimePresentation = {
  text: string;
  title?: string;
  dateTime?: string;
  visualDateTime?: string;
  visualDateTimePolicy?: 'viewer_local';
};

export function resolveDisplayTimeZone(locale = 'en-US', timeZone?: string): string {
  if (timeZone) {
    return timeZone;
  }

  try {
    const resolvedTimeZone = new Intl.DateTimeFormat(locale).resolvedOptions().timeZone;
    if (resolvedTimeZone) {
      return resolvedTimeZone;
    }
  } catch {
    // Fall through to UTC if the runtime cannot resolve a viewer timezone.
  }

  return 'UTC';
}

export function formatDisplayDateTime(
  value?: string | null,
  options: DisplayDateTimeOptions = {},
): string {
  const {
    locale = 'en-US',
    emptyText = '-',
    invalidText = '-',
  } = options;
  const timeZone = resolveDisplayTimeZone(locale, options.timeZone);

  if (!value) {
    return emptyText;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return invalidText;
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(date);
  }
}

export function getViewerLocalDateTimePresentation(
  value?: string | null,
  options: DisplayDateTimeOptions = {},
): ViewerLocalDateTimePresentation {
  const {
    emptyText = '-',
    invalidText = '-',
  } = options;

  if (!value) {
    return {
      text: emptyText,
    };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      text: invalidText,
    };
  }

  const machineReadableValue = date.toISOString();
  const label = formatDisplayDateTime(machineReadableValue, options);
  return {
    text: label,
    title: label,
    dateTime: machineReadableValue,
    visualDateTime: machineReadableValue,
    visualDateTimePolicy: 'viewer_local',
  };
}
