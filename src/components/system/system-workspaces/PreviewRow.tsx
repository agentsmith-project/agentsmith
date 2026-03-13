export function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-tertiary">{label}</span>
      <code className="break-all text-right text-foreground">{value}</code>
    </div>
  );
}
