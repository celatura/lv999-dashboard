# AGENTS.md - AI Coding Agent Reference

This file provides essential information for AI coding agents working on this project. It contains project-specific details, conventions, and guidelines that complement the README.

---

## Project Overview

**LV999** is an AI-native multimodal creation platform (Agent creation, design canvas, RAG knowledge base, and a unified asset library) built on top of a production-grade admin dashboard base. Tech stack:

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5.7
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui (base-nova style, Base UI primitives)
- **Authentication**: Clerk (single-user; Organizations feature disabled)
- **Charts**: Recharts
- **Containerization**: Docker (Node.js & Bun Dockerfiles)
- **Package Manager**: Bun (preferred) or npm

The project follows a feature-based folder structure designed for scalability in SaaS applications, internal tools, and admin panels.

---

## Technology Stack Details

### Core Framework & Runtime

- Next.js 16.2.x with App Router
- React 19.2.x
- TypeScript 5.7.2 with strict mode enabled

### Styling & UI

- Tailwind CSS v4 (using `@import 'tailwindcss'` syntax)
- PostCSS with `@tailwindcss/postcss` plugin
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

- Clerk for authentication and user management
- Organizations / multi-tenancy are **disabled** — core business is isolated by `userId` (single-admin model)
- Client-side nav filtering is for UX only; real authorization is server-side `isAdmin` (see "Authentication Patterns")

### Data & APIs

- TanStack Table for data tables
- TanStack React Query for data fetching and mutations
- Recharts for analytics/charts
- Service layer per feature (`api/types.ts` → `api/service.ts` → `api/queries.ts`)
- Route handlers at `src/app/api/` (for Route Handler or BFF patterns)
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
│   ├── auth/              # Authentication routes (sign-in, sign-up)
│   ├── dashboard/         # Dashboard routes
│   │   ├── overview/      # Analytics (parallel routes @area_stats/@bar_stats/@pie_stats/@sales)
│   │   ├── agent/         # Agent creation (conversations + [conversationId])
│   │   ├── assets/        # My assets (assets table)
│   │   ├── design/        # Design canvas (new + [id] editor)
│   │   ├── knowledge/     # RAG knowledge base
│   │   ├── admin/         # User management (isAdmin only)
│   │   └── profile/       # User profile (+ credits)
│   ├── api/               # Route handlers: agent (chat/conversations/assets/knowledge/…) + admin
│   ├── layout.tsx         # Root layout with providers
│   ├── page.tsx           # Landing page
│   ├── global-error.tsx   # Global error boundary
│   └── not-found.tsx      # 404 page
│
├── components/
│   ├── ui/                # shadcn/ui components (50+ components)
│   ├── layout/            # Layout components (sidebar, header, etc.)
│   ├── forms/             # Field components (shadcn TanStack Form anatomy) + demos
│   ├── themes/            # Theme system components
│   ├── kbar/              # Command+K search bar
│   ├── icons.tsx          # Icon registry
│   └── ...
│
├── features/              # Feature-based modules
│   ├── agent/             # Agent creation (chat / assets / generation)
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
│   ├── user-management.md # Admin user management & server-side auth
│   ├── clerk_setup.md     # Clerk configuration guide
│   ├── nav-rbac.md        # Navigation RBAC documentation
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

### Required for Authentication (Clerk)

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# App base URL (used for metadataBase)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Redirect URLs
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/auth/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/auth/sign-up"
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL="/dashboard/overview"
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL="/dashboard/overview"
```

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

The `NavItem.access` field and its properties (`requireOrg` / `permission` / `role` / `plan` / `feature`) still exist in `src/types/index.ts` for backward compatibility, **but org-based checks no longer resolve**: `use-nav.ts` hardcodes the access context to `hasOrg = false`, so any item carrying `requireOrg` / `permission` / `role` is **hidden** in the current single-user deployment. Prefer leaving `access` off — show admin-only entries via the server-side `isAdmin` path below instead.

### Client-Side Filtering

The `useFilteredNavGroups()` / `useFilteredNavItems()` hooks in `src/hooks/use-nav.ts` filter navigation synchronously on the client (UX only — no `useOrganization` / `useUser` calls, which would re-trigger Clerk's "Organizations feature required" popup). Real security is enforced server-side.

---

## Authentication Patterns

### Protected Routes

Dashboard routes are behind Clerk's middleware. For admin-only pages / endpoints, enforce the server-side whitelist `isAdmin` (`src/lib/admin.ts`, backed by `ADMIN_USER_IDS`). This is the ONLY security boundary — client-side entry visibility is UX.

```tsx
import { auth } from '@clerk/nextjs';
import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/admin';

export default async function AdminPage() {
  const { userId } = await auth();
  if (!isAdmin(userId)) redirect('/dashboard/overview');
  // ...
}
```

In route handlers, return `403` for non-admins. See [docs/user-management.md](./docs/user-management.md).

### Plan/Feature Protection

Use Clerk's `<Protect>` component for client-side:

```tsx
import { Protect } from '@clerk/nextjs';

<Protect plan='pro' fallback={<UpgradePrompt />}>
  <PremiumContent />
</Protect>;
```

Use `has()` function for server-side checks:

```tsx
import { auth } from '@clerk/nextjs';

const { has } = await auth();
const hasFeature = has({ feature: 'premium_access' });
```

---

## Data Fetching Patterns

### Service Layer Architecture

Each feature has a three-file API layer:

```
src/features/<name>/api/
  types.ts      ← Type contract (response shapes, filters, payloads)
  service.ts    ← Data access functions (the ONE file to swap for your backend)
  queries.ts    ← React Query options + query key factories (stable, never changes)
```

**`service.ts` is the only file you modify when connecting to a real backend.** Queries and components import from it — they never change.

#### Backend Patterns

| Pattern                                            | How to implement                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Server Actions + ORM** (Prisma/Drizzle/Supabase) | Add `'use server'` at top of `service.ts`, call ORM directly                                |
| **Route Handlers + ORM**                           | `service.ts` calls `/api/` routes via `apiClient`, route handlers call ORM                  |
| **BFF** (Next.js proxies to Laravel/Go/etc.)       | `service.ts` calls `/api/` routes via `apiClient`, route handlers proxy to external backend |
| **Direct external API** (frontend-only)            | `service.ts` calls external URL via `fetch()`                                               |

Route handlers at `src/app/api/` are ready for patterns 2 and 3. `src/lib/api-client.ts` provides a typed `fetch` wrapper.

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

1. **Query options** defined in `queries.ts` — shared between server prefetch and client hooks
2. **Server prefetch** using `void queryClient.prefetchQuery()` + `HydrationBoundary` + `dehydrate` — `void` (fire-and-forget) is the standard TanStack pattern for Next.js App Router
3. **Client fetch** using `useSuspenseQuery()` — integrates with React Suspense so prefetched data streams in without showing a loading skeleton on first load
4. **Suspense boundary** wraps the client component — shows a fallback skeleton only on subsequent client-side navigations when cache is empty

```tsx
// Server component: prefetch + dehydrate
const queryClient = getQueryClient();
void queryClient.prefetchQuery(entitiesQueryOptions(filters)); // void, not await

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

Components import service functions for mutations. Use query key factories for invalidation:

```tsx
import { createEntity } from '../api/service';
import { entityKeys } from '../api/queries';

const mutation = useMutation({
  mutationFn: (data) => createEntity(data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: entityKeys.all });
    toast.success('Created');
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
- Column definitions in `features/*/components/*-tables/columns.tsx`
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

### Vercel (Recommended)

1. Connect repository to Vercel
2. Add environment variables in dashboard
3. Deploy

### Environment Variables for Production

Ensure these are set in your deployment platform:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- All `NEXT_PUBLIC_*` variables for client-side access

### Docker

Production-ready Dockerfiles are included:

- `Dockerfile` — Node.js-based
- `Dockerfile.bun` — Bun-based

Both use `output: 'standalone'` in `next.config.ts`. Pass `NEXT_PUBLIC_*` vars as `--build-arg` at build time, and runtime secrets via `-e` at run time.

### Build Considerations

- Output: `standalone` (optimized for Docker/self-hosting)
- Images: `remotePatterns` configured for `img.clerk.com` and `clerk.com`

---

## Icon System

**All icons come from a single source: `src/components/icons.tsx`.**

The project uses `@tabler/icons-react` as the sole icon package. Every icon is re-exported through a centralized `Icons` object — **never import directly from `@tabler/icons-react` or any other icon package**.

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
2. Create `src/features/<name>/api/service.ts` — data access functions (backed by real services: Drizzle/PostgreSQL, OSS, Alibaba Cloud Model Studio, Redis)
3. Create `src/features/<name>/api/queries.ts` — query key factory + `queryOptions`
4. Create page route: `src/app/dashboard/<name>/page.tsx`
5. Create feature components in `src/features/<name>/components/`
6. Add navigation item in `src/config/nav-config.ts`
7. (Optional) Add route handlers in `src/app/api/<name>/` for REST API patterns
8. (Optional) Register new icon in `src/components/icons.tsx`

### Adding a New API Route

1. Create: `src/app/api/my-route/route.ts`
2. Export HTTP method handlers: `GET`, `POST`, etc.
3. For BFF pattern: proxy requests to your external backend

### Adding a shadcn Component

```bash
npx shadcn add component-name
```

### Adding a New Theme

See "Theming System" section above or `docs/themes.md`.

---

## Troubleshooting

### Common Issues

**Build fails with Tailwind errors**

- Ensure using Tailwind CSS v4 syntax (`@import 'tailwindcss'`)
- Check `postcss.config.js` uses `@tailwindcss/postcss`

**Clerk keyless mode popup**

- Run `npx clerk@latest init` to provision a dev instance in seconds (no account needed)
- It writes keys to `.env.local`; later you can claim application or set env variables

**Theme not applying**

- Check theme name matches in CSS `[data-theme]` and `theme.config.ts`
- Verify theme CSS is imported in `theme.css`

**Navigation items not showing**

- Items left without `access` always show; anything with `requireOrg`/`permission`/`role` is hidden (org context is disabled)
- Admin-only entries live in the account dropdown and are gated server-side by `isAdmin` / `ADMIN_USER_IDS`, not by nav `access`

---

## External Documentation

- [Next.js App Router](https://nextjs.org/docs/app)
- [Clerk Next.js SDK](https://clerk.com/docs/references/nextjs)
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
8. **Icons** - NEVER import icons directly from `@tabler/icons-react` or any other icon package. All icons must be registered in `src/components/icons.tsx` and imported as `import { Icons } from '@/components/icons'`. To add a new icon: add the tabler import to `icons.tsx`, add a semantic key to the `Icons` object, then use `Icons.keyName` in your component.
9. **Page headers** - Always use `PageContainer` props (`pageTitle`, `pageDescription`, `pageHeaderAction`) for page headers. Never import `<Heading>` manually in pages — `PageContainer` handles that internally.
10. **Forms** - Use `useAppForm` from `@/lib/form` with `form.AppField` rendering the shared field components (`field.TextField`, `field.SelectField`, …) from `@/components/forms/fields`. Each component follows the official shadcn TanStack Form anatomy; drop down to raw `form.Field` render props for one-off custom fields. Never use `useState` inside a render prop — extract stateful controls into components.
11. **Button loading** - Use `<Button isLoading={isPending}>` for loading states. Uses CSS Grid overlap trick for zero layout shift. When `isLoading` is not passed, button behaves as default shadcn. `SubmitButton` in forms handles this automatically via form `isSubmitting` state.
12. **Data layer** - Always go through the service layer: `types.ts` → `service.ts` → `queries.ts`. Components import types from `types.ts`, functions from `service.ts`, query options from `queries.ts`. Services hit real backends (Drizzle/PostgreSQL, OSS, Alibaba Cloud Model Studio, Redis).
13. **Model registries** - Keep the internal key stable (it is the persisted `conversations.model` value and the credits pricing key); only change `providerModelId`. Prefer **mainline model names over date-suffixed snapshots** — Alibaba retires snapshots with 30 days' notice vs 3 months for mainline models. Callers must route model errors through `detectModelUnavailable()` (`features/agent/api/model-availability.ts`) so retired/unpurchased models (`403 access_denied`) are not reported as auth failures. Run `bun run scripts/model-audit.ts` after any retirement notice (`--image` / `--video` / `--all` add the paid channels). See docs/agent.md §7.
