export function formatDuration(sec?: number): string {
  if (sec == null || sec < 0) return '—';
  if (sec < 60) return `${sec}s`;
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
