# AGENTS.md - AI Coding Agent Reference

This file provides essential information for AI coding agents working on this project. It contains project-specific details, conventions, and guidelines that complement the README.

---

## Project Overview

**LV999** is an AI-native multimodal creation platform (Agent creation, design canvas, RAG knowledge base, and a unified asset library) built on top of a production-grade admin dashboard base. Tech stack:

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 7
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui (base-nova style, Base UI primitives)
- **Authentication**: Better Auth (self-hosted; email + password)
- **Charts**: Recharts
- **Containerization**: Docker (Node.js & Bun Dockerfiles)
- **Package Manager**: Bun (preferred; `lint:fix` invokes `bun format`) or npm

The project follows a feature-based folder structure designed for scalability in SaaS applications, internal tools, and admin panels.

---

## Technology Stack Details

### Core Framework & Runtime

- Next.js 16.4 with App Router
- React 19.3
- Node.js 24 (Node/Docker deployment) / Bun (local dev, recommended; Bun Dockerfile available)
- TypeScript 7 (native compiler) with strict mode enabled

### Styling & UI

- Tailwind CSS v4 (using `@import 'tailwindcss'` syntax)
- Tailwind via the `@tailwindcss/turbopack` loader, registered in `next.config.ts` under `turbopack.rules` for `*.css`
- shadcn/ui component library (Base UI primitives)
- CSS custom properties for theming (OKLCH color format)

### State Management

- Nuqs for URL search params state management
- TanStack Form + Zod for form handling (`createFormHook` + shadcn `Field`-anatomy components)

### Data Fetching & Caching

- TanStack React Query for data fetching, caching, and mutations
- Server-side prefetching with `HydrationBoundary` + `dehydrate`
- Client-side `useSuspenseQuery` + nuqs `shallow: true` for tables (no RSC round-trips on pagination/filter)
- `useMutation` + `invalidateQueries` for form submissions
- Query client singleton in `src/lib/query-client.ts`

### Authentication & Authorization

- Better Auth (self-hosted) for authentication; the Drizzle adapter reuses the existing RDS — see [docs/auth.md](./docs/auth.md)
- Email + password only (OAuth / 2FA / organization plugins deferred); core business is isolated by `userId` (single-admin model)
- Server-side session reads go through the DAL `src/lib/auth-session.ts` (`verifySession` / `getUserId`); client-side nav filtering is UX only, real authorization is server-side `isAdmin` (see "Authentication Patterns")

### Data & APIs

- TanStack Table for data tables
- TanStack React Query for data fetching and mutations
- Recharts for analytics/charts
- Service layer per feature (`api/types.ts` → `api/service.ts` (server-side) → `api/queries.ts` / `api/mutations.ts` → Route Handler)
- Route handlers at `src/app/api/` (client-side data boundary; BFF proxies when needed)
- Real backend is already wired in: Drizzle ORM + PostgreSQL; the agent / design / knowledge / credits features hit DB / OSS / Redis / Alibaba Cloud Model Studio directly
- API client utility in `src/lib/api-client.ts` (for fetch-based patterns)

### Development Tools

- Oxlint (`.oxlintrc.json`) for linting
- Oxfmt (`.oxfmtrc.json`) for formatting
- Husky for git hooks
- lint-staged for pre-commit formatting

---

## Project Structure

```
/src
├── app/                    # Next.js App Router
│   ├── auth/              # Authentication routes (sign-in, sign-up, forgot/reset password)
│   ├── dashboard/         # Dashboard routes
│   │   ├── overview/      # Analytics (parallel routes @area_stats/@bar_stats/@pie_stats/@sales)
│   │   ├── agent/         # Agent creation (conversations + [conversationId])
│   │   ├── skills/        # Expert skills management
│   │   ├── assets/        # My assets (assets table)
│   │   ├── design/        # Design canvas (new + [id] editor)
│   │   ├── knowledge/     # RAG knowledge base
│   │   ├── admin/         # User management (isAdmin only)
│   │   └── profile/       # User profile (+ credits)
│   ├── api/               # Route handlers: agent (chat/conversations/assets/knowledge/skills/credits), auth, admin, avatar, health, user
│   ├── layout.tsx         # Root layout with providers
│   ├── page.tsx           # Landing page
│   ├── global-error.tsx   # Global error boundary
│   └── not-found.tsx      # 404 page
│
├── components/
│   ├── ui/                # shadcn/ui components (50+ components)
│   ├── layout/            # Layout components (sidebar, header, etc.)
│   ├── forms/             # Field components (shadcn TanStack Form anatomy)
│   ├── themes/            # Theme system components
│   ├── kbar/              # Command+K search bar
│   ├── icons.tsx          # Icon registry
│   └── ...
│
├── features/              # Feature-based modules
│   ├── agent/             # Agent creation (chat / skills / assets / generation)
│   ├── design/            # Design canvas (Konva editor)
│   ├── knowledge/         # RAG knowledge base (pgvector)
│   ├── credits/           # Credits billing (accounts + ledger)
│   ├── admin/             # Admin user management
│   ├── auth/              # Authentication components
│   ├── overview/          # Dashboard analytics
│   └── profile/           # Profile management
│
├── config/                # Configuration files
│   ├── nav-config.ts      # Navigation with RBAC
│   └── ...
│
├── hooks/                 # Custom React hooks
│   ├── use-nav.ts         # RBAC navigation filtering
│   ├── use-data-table.ts  # Data table state
│   └── ...
│
├── lib/                   # Utility functions
│   ├── utils.ts           # cn() and formatters
│   ├── searchparams.ts    # Search param utilities
│   └── ...
│
├── types/                 # TypeScript type definitions
│   └── index.ts           # Core types (NavItem, etc.)
│
└── styles/                # Global styles
    ├── globals.css        # Tailwind imports + view transitions
    ├── theme.css          # Theme imports
    └── themes/            # Individual theme files

/docs                      # Documentation
│   ├── agent.md           # Agent creation module (architecture / data model / streaming)
│   ├── design-editor.md   # Design canvas editor
│   ├── knowledge-base.md  # RAG knowledge base
│   ├── credits.md         # Credits billing rules
│   ├── auth.md            # Better Auth (self-hosted): architecture / DAL / security
│   ├── user-management.md # Admin user management & server-side auth
│   ├── nav-rbac.md        # Navigation RBAC documentation
│   ├── forms.md           # TanStack Form + shadcn field anatomy
│   ├── video-generation.md # Video generation channel
│   ├── deployment.md      # Deployment (Docker / Vercel)
│   └── themes.md          # Theme customization guide

Dockerfile                 # Node.js production Dockerfile
Dockerfile.bun             # Bun production Dockerfile
.dockerignore              # Docker build exclusions
```

---

## Build & Development Commands

```bash
# Install dependencies
bun install

# Development server
bun run dev          # Starts at http://localhost:3000

# Build for production
bun run build

# Start production server
bun run start

# Linting
bun run lint         # Run Oxlint
bun run lint:fix     # Auto-fix and format
bun run lint:strict  # Zero warnings tolerance

bun run typecheck    # tsc --noEmit

# Formatting
bun run format       # Format with Oxfmt
bun run format:check # Check formatting

# Git hooks
bun run prepare      # Install Husky hooks
```

---

## Environment Configuration

Copy `env.example.txt` to `.env.local` and configure:

### Required for Authentication (Better Auth)

```env
# Encryption secret (min 32 chars; generate: openssl rand -base64 32)
BETTER_AUTH_SECRET=...
# App base URL (HTTPS in production); Better Auth infers cookie domain & callbacks from it
BETTER_AUTH_URL=http://localhost:3000

# App base URL (used for metadataBase)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# SMTP for password-reset emails (reset unavailable if unset; sign-in/up unaffected)
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Admin whitelist (comma-separated Better Auth user ids; empty = no admin)
ADMIN_USER_IDS=
```

### Full Environment Set

The auth block above is only enough to sign in. Core app features also need:

- `DATABASE_URL` — PostgreSQL (overview / agent / knowledge / design / credits)
- `DASHSCOPE_API_KEY` — Alibaba Cloud Model Studio (chat / image / video / embeddings)
- `OSS_REGION`, `OSS_BUCKET`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET` — asset storage
- `REDIS_URL` — resumable streams, stop signals, rate limiting

For Docker / self-hosting, also set `BUILD_STANDALONE=true`. See [`env.example.txt`](./env.example.txt) for the full commented list and [docs/agent.md](./docs/agent.md) for the module-level breakdown.

## Code Style Guidelines

### TypeScript

- Strict mode enabled
- Use explicit return types for public functions
- Prefer interface over type for object definitions
- Use `@/*` alias for imports from src

### Formatting (Oxfmt)

Configured in `.oxfmtrc.json` — 2-space indent, single quotes (including JSX), semicolons, no trailing commas, LF line endings, plus automatic Tailwind class sorting.

### Oxlint Rules

Configured in `.oxlintrc.json` — `correctness` category as errors, `suspicious` as warnings. Key project rules:

- `no-console`: warn (`warn` / `error` allowed)
- `no-unused-vars`: warn (ignores `_`-prefixed)
- `@typescript-eslint/no-explicit-any`: warn
- `react-hooks/exhaustive-deps`: warn
- jsx-a11y rules enabled (alt-text, aria props/roles)

### Component Conventions

- Use function declarations for components: `function ComponentName() {}`
- Props interface named `{ComponentName}Props`
- shadcn/ui components use `cn()` utility for class merging
- Server components by default, `'use client'` only when needed

---

## Theming System

The project supports a multi-theme system driven by `[data-theme]` CSS variables and a theme registry. It currently ships a single built-in theme (`vercel`); the steps below describe how to add more.

### Theme Files

- CSS files: `src/styles/themes/{theme-name}.css`
- Theme registry: `src/components/themes/theme.config.ts`
- Font config: `src/components/themes/font.config.ts`
- Active theme provider: `src/components/themes/active-theme.tsx`

### Adding a New Theme

1. Create `src/styles/themes/your-theme.css` with `[data-theme='your-theme']` selector
2. Import in `src/styles/theme.css`
3. Add to `THEMES` array in `src/components/themes/theme.config.ts`
4. (Optional) Add fonts in `font.config.ts`
5. (Optional) Set as default in `theme.config.ts`

See `docs/themes.md` for detailed theming guide.

---

## Navigation & RBAC System

### Navigation Configuration

Navigation is organized into groups in `src/config/nav-config.ts` (illustrative shape — the real `label` / `title` values are Chinese UI strings defined in that file):

```typescript
import { NavGroup } from '@/types';

export const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        title: 'Agent Creation',
        url: '/dashboard/agent',
        icon: 'sparkles',
        shortcut: ['a', 'a'],
        items: []
      }
    ]
  }
];
```

### Access Control Properties (vestigial)

The `NavItem.access` field and its properties (`requireOrg` / `permission` / `role` / `plan` / `feature`) still exist in `src/types/index.ts` for backward compatibility, **but org-based checks no longer resolve**: `use-nav.ts` hardcodes the access context to `hasOrg = false`, so any item carrying `requireOrg` / `permission` / `role` is **hidden** in the current single-admin (no-org) deployment. Prefer leaving `access` off — show admin-only entries via the server-side `isAdmin` path below instead.

### Client-Side Filtering

The `useFilteredNavGroups()` / `useFilteredNavItems()` hooks in `src/hooks/use-nav.ts` filter navigation synchronously on the client (UX only — no session / org lookups). Real security is enforced server-side.

---

## Authentication Patterns

Better Auth is self-hosted; see [docs/auth.md](./docs/auth.md) for the full architecture. Key files: `src/lib/auth.ts` (config), `src/app/api/auth/[...all]/route.ts` (`toNextJsHandler`), `src/lib/auth-client.ts` (`createAuthClient`), and the DAL `src/lib/auth-session.ts`.

### Protected Routes

The `/dashboard` layout gates on a real session (`verifySession`); `src/proxy.ts` only does an optimistic cookie redirect (not a security boundary). For admin-only pages / endpoints, enforce the server-side whitelist `isAdmin` (`src/lib/admin.ts`, backed by `ADMIN_USER_IDS`). This is the ONLY security boundary — client-side entry visibility is UX.

```tsx
import { notFound } from 'next/navigation';
import { getUserId } from '@/lib/auth-session';
import { isAdmin } from '@/lib/admin';

export default async function AdminPage() {
  const userId = await getUserId();
  if (!isAdmin(userId)) notFound();
  // ...
}
```

Pages use `notFound()` rather than a redirect so non-admins cannot confirm that the admin page exists.

In route handlers, return `401` when `getUserId()` is null and `403` for non-admins. Never call `auth.api.getSession` directly — always go through the DAL. See [docs/user-management.md](./docs/user-management.md).

### Session in Components

- Server: `verifySession()` → `{ userId, user, session } | null`.
- Client: `authClient.useSession()`. The dashboard sidebar instead receives `user` as a server-injected prop (from the layout's `verifySession`) to avoid a second client fetch and avatar flash.

---

## Data Fetching Patterns

### Service Layer Architecture

Each feature has an API layer (add `mutations.ts` when the feature has writes):

```
src/features/<name>/api/
  types.ts      ← Type contract (response shapes, filters, payloads)
  service.ts    ← Server-side data access (Drizzle / external API) — imported by Route Handlers + server prefetch
  queries.ts    ← Query keys + queryOptions (client: apiClient → Route Handler)
  mutations.ts  ← mutationOptions (client: apiClient → Route Handler)
```

**`service.ts` is the server-side data boundary.** Client code never imports it; client reads/writes go through `queries.ts` / `mutations.ts` via `apiClient`. Server Components prefetch with the same query key and call `service.ts` directly, so server and client share one cache entry. This is a project convention rather than a build-time guarantee — the service files do not currently `import 'server-only'`.

#### Backend Patterns

| Pattern                                            | How to implement                                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Server Actions + ORM** (Prisma/Drizzle/Supabase) | Add `'use server'` at top of `service.ts`, call ORM directly                                                         |
| **Route Handlers + ORM** (this project)            | `service.ts` is server-side and calls the ORM (Drizzle); Route Handlers import it; client `queries.ts` fetches `/api/...` via `apiClient` |
| **BFF** (Next.js proxies to Laravel/Go/etc.)       | Route Handlers proxy to the external backend; `service.ts` holds the server-side mapping; client calls `apiClient`    |
| **Direct external API**                            | `service.ts` calls the external URL server-side via `fetch()`                                                        |

Route handlers at `src/app/api/` are the boundary for client-side data; `src/lib/api-client.ts` provides the typed `fetch` wrapper used by `queries.ts` / `mutations.ts`.

### Query Key Factories

Each feature defines a key factory in `queries.ts` for type-safe, hierarchical cache invalidation:

```tsx
export const entityKeys = {
  all: ['entities'] as const,
  list: (filters: EntityFilters) => [...entityKeys.all, 'list', filters] as const,
  detail: (id: number) => [...entityKeys.all, 'detail', id] as const
};

// Usage in queryOptions
queryKey: entityKeys.list(filters);

// Usage in mutations — invalidate all entity queries
queryClient.invalidateQueries({ queryKey: entityKeys.all });
```

### React Query (Default for all new pages)

The project uses TanStack React Query with server-side prefetching and client-side cache management:

1. **Query keys** defined in `queries.ts` — shared between server prefetch and client hooks; the client `queryFn` uses `apiClient`
2. **Server prefetch** using `void queryClient.prefetchQuery()` + `HydrationBoundary` + `dehydrate` — `void` (fire-and-forget) is the standard TanStack pattern for Next.js App Router
3. **Client fetch** using `useSuspenseQuery()` — integrates with React Suspense; if the `void` prefetch has not resolved by hydration, the client suspends and the fallback shows while data streams in
4. **Suspense boundary** wraps the client component — the fallback can appear on the first load while the pending prefetch resolves, and on subsequent client-side navigations when cache is empty; cached visits within `staleTime` show no skeleton

```tsx
// Server component: prefetch + dehydrate.
// Reuse the client queryKey, but call the server-side service directly —
// apiClient uses a relative /api URL and cannot run inside a Server Component.
const queryClient = getQueryClient();
void queryClient.prefetchQuery({
  queryKey: entitiesQueryOptions(filters).queryKey,
  queryFn: () => listEntities(userId, filters) // service.ts
});

return (
  <HydrationBoundary state={dehydrate(queryClient)}>
    <Suspense fallback={<Skeleton />}>
      <EntityTable />
    </Suspense>
  </HydrationBoundary>
);

// Client component: useSuspenseQuery (not useQuery)
const { data } = useSuspenseQuery(entitiesQueryOptions(filters));
```

The server prefetch `queryFn` must return exactly the same shape as the client `apiClient` response — a historic mismatch broke hydration (see the comments in `knowledge-listing.tsx` / `credits-listing.tsx`).

**Why `void` + `useSuspenseQuery`:**

- `void` fires the prefetch without blocking the server component
- `useSuspenseQuery` integrates with React Suspense — the pending query streams in via Next.js streaming SSR
- With `<Suspense fallback={<Skeleton />}>`: skeleton shows immediately while data streams in — this is expected behavior, the skeleton IS the Suspense fallback during streaming
- Without `<Suspense>` wrapper: no skeleton, but the previous page stays visible until data fully resolves (feels like a slow navigation)
- Once data is cached (within `staleTime`), subsequent visits are instant — no skeleton

**Why NOT `useQuery`:**

- `useQuery` doesn't integrate with Suspense — returns `isLoading: true` and you must handle loading state manually
- Hydrated pending queries from `void` prefetch won't prevent the loading state
- Results in skeleton flash even when data is prefetched

### Mutations

Client components never import the server-side `service.ts`. Write operations go through `apiClient` — usually encapsulated in `api/mutations.ts` as `mutationOptions`, passed directly to `useMutation(options)`; add UI callbacks per call via `mutate(vars, { onSuccess })`:

```tsx
import { createEntityMutation } from '../api/mutations';

const mutation = useMutation(createEntityMutation);
mutation.mutate(data, { onSuccess: () => toast.success('Created') });
```

Callbacks passed to `mutate` / `mutateAsync` run **in addition to** `mutationOptions.onSuccess`; a new `onSuccess` spread into `useMutation` would replace the shared one and skip cache invalidation.

`mutationOptions` owns the request and cache invalidation:

```tsx
export const createEntityMutation = mutationOptions({
  mutationFn: (data: EntityMutationPayload) =>
    apiClient<{ id: string }>('/entities', { method: 'POST', body: JSON.stringify(data) }),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: entityKeys.all });
  }
});
```

### URL State Management

Use `nuqs` for search params state:

- `searchParamsCache` (server) — reads params in server components
- `useQueryState` (client) — reads/writes params in client components with `shallow: true`

### Data Tables

Tables use TanStack Table with React Query:

- Query options in `features/*/api/queries.ts`
- Column definitions in `features/*/components/*-table*/columns.tsx`
- Table component in `src/components/ui/table/data-table.tsx`
- Column pinning via `initialState.columnPinning` in `useDataTable`

---

## Error Handling & Monitoring

### Error Boundaries

- `src/app/global-error.tsx` for app-level failures
- Parallel route `error.tsx` files for specific sections

---

## Testing Strategy

**Note**: This project does not include a test suite by default. Consider adding:

- **Unit tests**: Vitest or Jest for utilities and hooks
- **Component tests**: React Testing Library for UI components
- **E2E tests**: Playwright for critical user flows

Recommended test locations:

```
/src
  /__tests__           # Unit tests
  /features/*/tests    # Feature tests
/e2e                   # Playwright tests
```

---

## Deployment

Canonical guide: [docs/deployment.md](./docs/deployment.md) (Vercel, production environment variables, Docker).

### Vercel (Supported)

Vercel is supported, but the canonical deployment target is Docker self-hosting — see [docs/deployment.md](./docs/deployment.md).

1. Connect repository to Vercel
2. Add environment variables in dashboard
3. Deploy

### Environment Variables for Production

Ensure these are set in your deployment platform:

- `BETTER_AUTH_SECRET` (min 32 chars) and `BETTER_AUTH_URL` (HTTPS)
- `DATABASE_URL`; `SMTP_*` if password-reset email is needed
- `ADMIN_USER_IDS` (Better Auth user ids) for the admin backend
- `DASHSCOPE_API_KEY` for chat / image / video / embeddings
- `OSS_REGION`, `OSS_BUCKET`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET` for asset storage
- `REDIS_URL` for resumable streams, stop signals, and rate limiting
- `BUILD_STANDALONE=true` for Docker builds (not needed on Vercel)
- All `NEXT_PUBLIC_*` variables for client-side access

### Docker (Recommended)

Production-ready Dockerfiles are included:

- `Dockerfile` — Node.js-based
- `Dockerfile.bun` — Bun-based

Both Dockerfiles set `BUILD_STANDALONE=true`, which makes `next.config.ts` emit standalone output. Pass `NEXT_PUBLIC_*` vars as `--build-arg` at build time, and runtime secrets via `-e` at run time.

### Build Considerations

- Output: `standalone` (optimized for Docker/self-hosting)
- `serverExternalPackages`: `ali-oss`, `@firecrawl/anydoc`, `nodemailer` (Node-loaded, not bundled)

---

## Icon System

**Application code must use the icon registry in `src/components/icons.tsx`.**

The project uses `@tabler/icons-react` as the sole icon package. Feature, page, layout, and other application code must import icons through the centralized `Icons` object — **never import directly from `@tabler/icons-react` or any other icon package in application code**. The shadcn primitives under `src/components/ui/` are the exception: they import Tabler icons directly, matching the shadcn source they are generated from; do not refactor them just to route through `Icons`.

### Usage

```tsx
import { Icons } from '@/components/icons';

// In JSX
<Icons.search className='h-4 w-4' />
<Icons.chevronRight className='h-4 w-4' />

// Passing as a prop
icon={Icons.check}
```

### Adding a New Icon

1. Import the tabler icon in `src/components/icons.tsx`
2. Add a semantic key to the `Icons` object
3. Use `Icons.yourKey` everywhere — never the raw import

```tsx
// In src/components/icons.tsx
import { IconNewIcon } from '@tabler/icons-react';

export const Icons = {
  // ...existing icons
  newIcon: IconNewIcon
};
```

### Available Icon Categories

| Category        | Example Keys                                                                  |
| --------------- | ----------------------------------------------------------------------------- |
| General         | `check`, `close`, `search`, `settings`, `trash`, `spinner`, `info`, `warning` |
| Navigation      | `chevronDown`, `chevronLeft`, `chevronRight`, `chevronUp`, `chevronsUpDown`   |
| Layout          | `dashboard`, `kanban`, `panelLeft`                                            |
| User            | `user`, `account`, `profile`, `teams`                                         |
| Communication   | `chat`, `notification`, `phone`, `video`, `send`                              |
| Files           | `page`, `post`, `media`, `fileTypePdf`, `fileTypeDoc`                         |
| Actions         | `add`, `edit`, `upload`, `share`, `login`, `logout`                           |
| Theme           | `sun`, `moon`, `brightness`, `laptop`, `palette`                              |
| Text formatting | `bold`, `italic`, `underline`, `text`                                         |
| Data / Charts   | `trendingUp`, `trendingDown`, `eyeOff`, `adjustments`                         |

### Why This Pattern?

- **Single source of truth** — swap icon packages by editing one file
- **Semantic naming** — `Icons.trash` is clearer than `IconTrash` scattered across files
- **Discoverability** — autocomplete on `Icons.` shows every available icon
- **No direct dependencies** — components never couple to a specific icon package

---

## Common Development Tasks

### Adding a New Feature (End-to-End)

1. Create `src/features/<name>/api/types.ts` — response types, filter types, mutation payloads
2. Create `src/features/<name>/api/service.ts` (server-side) — data access functions (Drizzle/PostgreSQL, OSS, Alibaba Cloud Model Studio, Redis)
3. Create `src/features/<name>/api/queries.ts` and `mutations.ts` (when the feature writes) — `apiClient` → Route Handler
4. Create Route Handlers in `src/app/api/<name>/` — required for client-facing reads/writes; only skip for server-component-only features
5. Create page route: `src/app/dashboard/<name>/page.tsx`
6. Create feature components in `src/features/<name>/components/`
7. Add navigation item in `src/config/nav-config.ts`
8. (Optional) Register new icon in `src/components/icons.tsx`

### Adding a New API Route

1. Create: `src/app/api/my-route/route.ts`
2. Export HTTP method handlers: `GET`, `POST`, etc.
3. For BFF pattern: proxy requests to your external backend

### Adding a shadcn Component

```bash
bunx shadcn@latest add component-name
```

### Adding a New Theme

See "Theming System" section above or `docs/themes.md`.

---

## Troubleshooting

### Common Issues

**Build fails with Tailwind errors**

- Ensure using Tailwind CSS v4 syntax (`@import 'tailwindcss'`)
- Check `next.config.ts` `turbopack.rules` registers the `@tailwindcss/turbopack` loader for `*.css`

**Auth session always null / "Invalid origin"**

- Ensure `BETTER_AUTH_SECRET` (≥32 chars) and `BETTER_AUTH_URL` are set, and the request origin is in `trustedOrigins`
- Verify with `GET /api/auth/ok` → `{"ok":true}`; see [docs/auth.md](./docs/auth.md)

**Theme not applying**

- Check theme name matches in CSS `[data-theme]` and `theme.config.ts`
- Verify theme CSS is imported in `theme.css`

**Navigation items not showing**

- Items left without `access` always show; anything with `requireOrg`/`permission`/`role` is hidden (org context is disabled)
- Admin-only entries live in the account dropdown and are gated server-side by `isAdmin` / `ADMIN_USER_IDS`, not by nav `access`

---

## External Documentation

- [Next.js App Router](https://nextjs.org/docs/app)
- [Better Auth](https://better-auth.com/docs)
- [shadcn/ui](https://ui.shadcn.com/docs)
- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [TanStack Table](https://tanstack.com/table/latest)

---

## Notes for AI Agents

1. **Always use `cn()` for className merging** - never concatenate strings manually
2. **Respect the feature-based structure** - put new feature code in `src/features/`
3. **Server components by default** - only add `'use client'` when using browser APIs or React hooks
4. **Type safety first** - avoid `any`, prefer explicit types
5. **Follow existing patterns** - look at similar components before creating new ones
6. **Environment variables** - prefix with `NEXT_PUBLIC_` for client-side access
7. **shadcn components** - don't modify files in `src/components/ui/` directly; extend them instead
8. **Icons** - In application / feature code, NEVER import icons directly from `@tabler/icons-react` or any other icon package. Register new icons in `src/components/icons.tsx` and use `import { Icons } from '@/components/icons'`. To add a new icon: add the tabler import to `icons.tsx`, add a semantic key to the `Icons` object, then use `Icons.keyName` in your component. Exception: shadcn primitives in `src/components/ui/` may import Tabler icons directly; do not refactor them just for this rule.
9. **Page headers** - Always use `PageContainer` props (`pageTitle`, `pageDescription`, `pageHeaderAction`) for page headers. Never import `<Heading>` manually in pages — `PageContainer` handles that internally.
10. **Forms** - Use `useAppForm` from `@/lib/form` with `form.AppField` rendering the shared field components (`field.TextField`, `field.SelectField`, …) from `@/components/forms/fields`. Each component follows the official shadcn TanStack Form anatomy; drop down to raw `form.Field` render props for one-off custom fields. Never use `useState` inside a render prop — extract stateful controls into components.
11. **Button loading** - Use `<LoadingButton loading={isPending}>` from `@/components/ui/loading-button` for loading states (the base `Button` has no loading prop). It overlays a Spinner and keeps the label in layout (`opacity-0`), so toggling never shifts layout. When `loading` is not passed, it behaves like a normal `Button`. `SubmitButton` in forms wires this automatically via form `isSubmitting`.
12. **Data layer** - `types.ts` → `service.ts` (server-side) → `queries.ts` / `mutations.ts` → Route Handler. Client components import only types and queries/mutations; `service.ts` is called by Route Handlers and Server Components (prefetch) — never from client code. Services hit real backends (Drizzle/PostgreSQL, OSS, Alibaba Cloud Model Studio, Redis).
13. **Model registries** - Keep the internal key stable (it is the persisted `conversations.model` value and the credits pricing key); only change `providerModelId`. Prefer **mainline model names over date-suffixed snapshots** — Alibaba retires snapshots with 30 days' notice vs 3 months for mainline models. Callers must route model errors through `detectModelUnavailable()` (`src/features/agent/api/model-availability.ts`) so retired/unpurchased models (`403 access_denied`) are not reported as auth failures. Run `bun run scripts/model-audit.ts` after any retirement notice (`--image` / `--video` / `--all` add the paid channels). See docs/agent.md §7.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
