import { ReactNode } from 'react';

export default function MembersLayout({ children }: { children: ReactNode }) {
  return <div className="h-full min-w-0">{children}</div>;
}
