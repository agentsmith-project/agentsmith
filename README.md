# AgentSmith

AgentSmith is the admin interface for the Microservices-Based Agent System (MBOS). It provides workspace/project isolation, intelligent agent management, and multilingual support (English/Chinese).

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: TailwindCSS + shadcn/ui
- **Icons**: Lucide React
- **i18n**: next-intl (zh-CN / en-US)
- **State Management**: Zustand
- **API Mocking**: MSW (Mock Service Worker)
- **Component Docs**: Storybook

## Design System

See [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) for the design system index. All UI designs must follow the in-repo [视觉设计系统](./docs/UXUI/00-设计系统/视觉设计系统-v1.md).

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run Storybook
npm run storybook

# Build for production
npm run build

# Run production server
npm start
```

## Environment

Copy `.env.example` to `.env.local` and configure:

```bash
NEXT_PUBLIC_API_BASE=http://localhost:20000/api/v1
NEXT_PUBLIC_USE_MSW=false
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:18080/realms
NEXT_PUBLIC_KEYCLOAK_REALM=mbos
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=agentsmith
```

## Project Structure

```
src/
├── app/              # Next.js App Router
├── components/       # React components
├── lib/             # Utilities
│   ├── api/         # API client
│   ├── hooks/       # Custom hooks
│   ├── stores/      # Zustand stores
│   └── utils/       # Utilities
├── messages/        # i18n messages
└── types/           # TypeScript types
```

## Documentation

- [项目宪法 (Project Constitution)](./docs/项目宪法.md) — 产品目标、设计风格与功能范围之最高指导，防漂移
- [Design System](./DESIGN_SYSTEM.md)
- [Development Guide](./DEVELOPMENT.md)
- [Documentation Index](./docs/README.md) — contracts, UXUI, and other docs
- [i18n Internal Guide](./docs/UXUI/01-通用规范/2026-02-03-i18n-内部指南-v1.md)
