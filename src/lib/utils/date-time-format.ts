export type DisplayDateTimeOptions = {
  locale?: string;
  timeZone?: string;
  emptyText?: string;
  invalidText?: string;
};

export function formatDisplayDateTime(
  value?: string | null,
  options: DisplayDateTimeOptions = {},
): string {
  const {
    locale = 'en-US',
    timeZone = 'UTC',
    emptyText = '-',
    invalidText = '-',
  } = options;

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
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(date);
  }
}
