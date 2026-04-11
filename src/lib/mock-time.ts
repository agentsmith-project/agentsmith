export const MSW_REFERENCE_NOW_ISO = '2026-04-10T12:00:00.000Z';

export function getMswReferenceNow(): Date {
  return new Date(MSW_REFERENCE_NOW_ISO);
}
