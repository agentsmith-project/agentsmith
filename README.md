# MBOS Frontend

MBOS (Microservices-Based Agent System) Frontend v1

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

See `DESIGN_SYSTEM.md` for the complete design system reference.

**Important**: All UI designs must strictly follow the visual design system document:
`/home/percy/works/mygithub/mbos-server/文档/UXUI/2026-01-31-视觉设计系统-v1.md`

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
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=mbos-frontend
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

- [Design System](./DESIGN_SYSTEM.md)
- [Development Guide](./DEVELOPMENT.md)
- [Component Documentation](./docs/components.md)
- [Workspace/Project State Management](./docs/workspace-project-state-management.md)
- [i18n Internal Guide](./docs/I18N_INTERN_GUIDE.md)
