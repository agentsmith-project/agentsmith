'use client';

interface TaskPageLoadingStateProps {
  text: string;
}

export function TaskPageLoadingState({ text }: TaskPageLoadingStateProps) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-tertiary">{text}</div>
    </div>
  );
}

interface TaskPageNotFoundStateProps {
  backLabel: string;
  description: string;
  title: string;
  onBack: () => void;
}

export function TaskPageNotFoundState({
  backLabel,
  description,
  title,
  onBack,
}: TaskPageNotFoundStateProps) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
        <p className="text-sm text-tertiary mb-4">{description}</p>
        <button onClick={onBack} className="text-sm text-accent hover:underline">
          {backLabel}
        </button>
      </div>
    </div>
  );
}
