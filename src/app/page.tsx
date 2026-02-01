import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center space-y-6">
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold text-foreground">MBOS Frontend</h1>
          <p className="text-primary">Intelligent Agent Platform</p>
          <p className="text-tertiary">v1.0.0 | Design Phase Complete</p>
        </div>

        <div className="flex gap-4 justify-center pt-4">
          <Link
            href="/en-US/login"
            className="inline-flex items-center justify-center px-5 h-10 bg-hover hover:bg-hover/80 text-foreground font-medium rounded-sm border border-subtle transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            English Login
          </Link>
          <Link
            href="/zh-CN/login"
            className="inline-flex items-center justify-center px-5 h-10 bg-surface-high hover:bg-hover text-primary font-medium rounded-sm border border-subtle transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            中文登录
          </Link>
        </div>
      </div>
    </main>
  );
}
