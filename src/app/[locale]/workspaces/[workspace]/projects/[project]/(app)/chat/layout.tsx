import { ReactNode } from 'react';

export default function ChatLayout({ children }: { children: ReactNode }) {
  return <div className="h-full min-w-0">{children}</div>;
}
