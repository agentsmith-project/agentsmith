'use client';

interface ChatLoadingStateProps {
  loading: string;
}

export function ChatLoadingState({ loading }: ChatLoadingStateProps) {
  return (
    <div className="h-full flex items-center justify-center px-4">
      <div className="text-tertiary">{loading}</div>
    </div>
  );
}
