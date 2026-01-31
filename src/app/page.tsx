import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-6">
        <div className="space-y-4">
          <h1 className="text-4xl font-bold">MBOS Frontend</h1>
          <p className="text-secondary">Intelligent Agent Platform</p>
          <p className="text-tertiary">v1.0.0 | Design Phase Complete</p>
        </div>

        <div className="flex gap-4 justify-center pt-4">
          <Link
            href="/en-US/login"
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium rounded-lg transition-all duration-200"
          >
            English Login
          </Link>
          <Link
            href="/zh-CN/login"
            className="px-6 py-3 bg-surface border border-subtle hover:bg-hover text-primary font-medium rounded-lg transition-all duration-200"
          >
            中文登录
          </Link>
        </div>
      </div>
    </main>
  );
}
