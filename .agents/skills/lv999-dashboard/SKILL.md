---
name: lv999-dashboard
description: |
  Guide for building features, pages, tables, forms, themes, and navigation in this Next.js 16 shadcn dashboard template. Use this skill whenever the user wants to add a new page, create a feature module, build a data table, add a form, configure navigation items, add a theme, set up RBAC access control, or work with the dashboard's patterns and conventions. Also triggers when adding routes under /dashboard, working with Better Auth (self-hosted), wiring a feature service to Drizzle or Route Handlers, or modifying the sidebar. Even if the user doesn't mention "dashboard" explicitly — if they're adding UI, pages, or features to this project, use this skill.
---

# Dashboard Development Guide

This skill encodes the exact patterns and conventions used in this Next.js 16 + shadcn/ui admin dashboard template.

## Quick Reference: What Goes Where

| Task                  | Location                                |
| --------------------- | --------------------------------------- |
| New page              | `src/app/dashboard/<name>/page.tsx`     |
| New feature module    | `src/features/<name>/`                  |
| Feature components    | `src/features/<name>/components/`       |
| API types             | `src/features/<name>/api/types.ts`      |
| Service layer         | `src/features/<name>/api/service.ts`    |
| Query options         | `src/features/<name>/api/queries.ts`    |
| Mutation options      | `src/features/<name>/api/mutations.ts`  |
| Zod schemas           | `src/features/<name>/schemas/<name>.ts` |
| Filter/select options | `src/features/<name>/constants/`        |
| Nav config            | `src/config/nav-config.ts`              |
| Types                 | `src/types/index.ts`                    |
| Route handler         | `src/app/api/<domain>/.../route.ts`     |
| DB schema             | `src/lib/db/schema.ts`                  |
| API fetch wrapper     | `src/lib/api-client.ts`                 |
| Search params         | `src/lib/searchparams.ts`               |
| Query client          | `src/lib/query-client.ts`               |
| Theme CSS             | `src/styles/themes/<name>.css`          |
| Theme registry        | `src/components/themes/theme.config.ts` |
| Custom hook           | `src/hooks/`                            |
| Icons registry        | `src/components/icons.tsx`              |

---

## Adding a New Feature (End-to-End)

When a user asks to add a feature (e.g., "add an orders page"), follow these steps in order. Each step below shows the minimal pattern — see reference files for full templates.

### Step 1: Types + Service Layer (`src/features/<name>/api/`)

This project talks to a **real backend** — Drizzle ORM + PostgreSQL, Route Handlers, OSS/Redis/百炼. There is no mock layer: `service.ts` is the server-only file that knows where data comes from.

**Types** (`api/types.ts`) — define entity, filter, response and payload types locally:

```tsx
export interface Order {
  id: string;
  customer: string;
  status: string;
  total: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderFilters {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
}
export interface OrdersResponse {
  items: Order[];
  total: number;
}
export interface OrderMutationPayload {
  customer: string;
  status: string;
  total: number;
}
```

**Service** (`api/service.ts`) — server-only data access (imported by Route Handlers and server-component prefetch). Pick the pattern that matches the backend:

| Pattern | How |
| --- | --- |
| Server Actions + ORM | `'use server'` at the top of `service.ts`, call Drizzle directly |
| Route Handlers + ORM (this project) | `service.ts` is server-only and calls Drizzle; Route Handlers import it; client `queries.ts` calls `/api/...` via `apiClient` |
| BFF proxy | Route Handlers proxy to an external backend; `service.ts` holds the server-side mapping |
| Direct external API | `service.ts` calls the external URL server-side with `fetch()` |

```tsx
import { getDb } from '@/lib/db';
import type { OrderFilters, OrdersResponse } from './types';

export async function getOrders(userId: string, filters: OrderFilters): Promise<OrdersResponse> {
  const db = getDb();
  // Drizzle: where/orderBy/limit/offset + a parallel count() query
  return { items: [], total: 0 }; // replace with the real query result
}
```

Rules:

- `service.ts` is **server-only** (it imports `@/lib/db`); never import it from a client component.
- Client-side fetching goes through `queries.ts` (`apiClient` → Route Handler); components never touch `getDb()` or table schemas directly.
- Every data endpoint needs a Route Handler under `src/app/api/...` with `getUserId()` (or `isAdmin`) + the `apiError` envelope:

```tsx
// src/app/api/orders/route.ts
import { getUserId } from '@/lib/auth-session';
import { apiError } from '@/lib/api-error';
import { getOrders } from '@/features/orders/api/service';

export async function GET(request: Request) {
  const userId = await getUserId();
  if (!userId) return apiError(401, 'unauthorized', 'Unauthorized');
  // parse/validate query params → service → Response.json(result)
}
```

Reference implementations: `src/features/agent/api/service.ts`, `src/features/credits/api/service.ts`.

### Step 2: Queries + Mutations (`src/features/<name>/api/`)

Client-side data flows through `apiClient` → Route Handler. Server components prefetch with the **same query key** but call the server-only `service.ts` directly (see `src/features/agent/components/assets/asset-listing.tsx`), so both paths share one cache entry.

**Queries** (`api/queries.ts`) — query key factory + `queryOptions` (client fetches through `apiClient`):

```tsx
import { queryOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { Order, OrderFilters, OrdersResponse } from './types';

export function buildOrderQuery(filters: OrderFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.search) params.set('search', filters.search);
  if (filters.sort) params.set('sort', filters.sort);
  return params.toString();
}

export const orderKeys = {
  all: ['orders'] as const,
  list: (filters: OrderFilters) => [...orderKeys.all, 'list', filters] as const,
  detail: (id: string) => [...orderKeys.all, 'detail', id] as const
};

export const ordersQueryOptions = (filters: OrderFilters) =>
  queryOptions({
    queryKey: orderKeys.list(filters),
    queryFn: () => apiClient<OrdersResponse>(`/orders?${buildOrderQuery(filters)}`)
  });

export const orderByIdOptions = (id: string) =>
  queryOptions({
    queryKey: orderKeys.detail(id),
    queryFn: () => apiClient<Order>(`/orders/${id}`)
  });
```

`buildOrderQuery` follows the same URLSearchParams pattern as `buildAssetQuery` in `src/features/agent/api/queries.ts`.

Server prefetch reuses the same key and calls the service directly:

```tsx
void queryClient.prefetchQuery({
  queryKey: ordersQueryOptions(filters).queryKey,
  queryFn: () => getOrders(userId, filters) // server-only service
});
```

**Mutations** (`api/mutations.ts`) — use `mutationOptions` + `getQueryClient()` (not custom hooks with `useQueryClient()`), calling the Route Handler via `apiClient`:

```tsx
import { mutationOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { getQueryClient } from '@/lib/query-client';
import { orderKeys } from './queries';
import type { OrderMutationPayload } from './types';

export const createOrderMutation = mutationOptions({
  mutationFn: (data: OrderMutationPayload) =>
    apiClient<{ id: string }>('/orders', { method: 'POST', body: JSON.stringify(data) }),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: orderKeys.all });
  }
});

export const updateOrderMutation = mutationOptions({
  mutationFn: ({ id, values }: { id: string; values: OrderMutationPayload }) =>
    apiClient<{ id: string }>(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify(values) }),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: orderKeys.all });
  }
});

export const deleteOrderMutation = mutationOptions({
  mutationFn: (id: string) => apiClient<{ ok: true }>(`/orders/${id}`, { method: 'DELETE' }),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: orderKeys.all });
  }
});
```

`mutationOptions` is the right abstraction because it works outside React (event handlers, tests, utilities), is passed directly to `useMutation(options)`, and uses `getQueryClient()` which handles both SSR (fresh per request) and client (singleton) correctly. Add UI callbacks per call via `mutate(vars, { onSuccess })` — do NOT spread a new `onSuccess` into `useMutation`, which would replace the shared cache-invalidation callback. See [references/query-abstractions.md](references/query-abstractions.md) for the full rationale.

### Step 3: Zod Schema (`src/features/<name>/schemas/<name>.ts`)

```tsx
import { z } from 'zod';

export const orderSchema = z.object({
  customer: z.string().min(2, 'Customer name must be at least 2 characters'),
  status: z.string().min(1, 'Please select a status'),
  total: z.number({ message: 'Total is required' })
});

export type OrderFormValues = z.infer<typeof orderSchema>;
```

### Step 4: Feature Components

Create `src/features/<name>/components/` with:

**Listing page** (server component — `<name>-listing.tsx`):

```tsx
import { Suspense } from 'react';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getUserId } from '@/lib/auth-session';
import { getQueryClient } from '@/lib/query-client';
import { searchParamsCache } from '@/lib/searchparams';
import { ordersQueryOptions } from '../api/queries';
import { getOrders } from '../api/service';
import { OrderTable, OrderTableSkeleton } from './orders-table';

export default async function OrderListingPage() {
  const userId = await getUserId();
  if (!userId) return null;

  const page = searchParamsCache.get('page');
  const search = searchParamsCache.get('name');
  const pageLimit = searchParamsCache.get('perPage');
  const sort = searchParamsCache.get('sort');

  const filters = {
    page,
    limit: pageLimit,
    ...(search && { search }),
    ...(sort && { sort })
  };

  const queryClient = getQueryClient();
  // Reuse the client queryKey, but call the server-only service directly.
  void queryClient.prefetchQuery({
    queryKey: ordersQueryOptions(filters).queryKey,
    queryFn: () => getOrders(userId, filters)
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<OrderTableSkeleton />}>
        <OrderTable />
      </Suspense>
    </HydrationBoundary>
  );
}
```

**Table + skeleton** (client component — `orders-table/index.tsx`):

```tsx
'use client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { getSortingStateParser } from '@/lib/parsers';
import { useDataTable } from '@/hooks/use-data-table';
import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { Skeleton } from '@/components/ui/skeleton';
import { ordersQueryOptions } from '../../api/queries';
import { columns } from './columns';

const columnIds = columns.map((c) => c.id).filter(Boolean) as string[];

export function OrderTable() {
  const [params] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    perPage: parseAsInteger.withDefault(10),
    name: parseAsString,
    sort: getSortingStateParser(columnIds).withDefault([])
  });

  const filters = {
    page: params.page,
    limit: params.perPage,
    ...(params.name && { search: params.name }),
    ...(params.sort.length > 0 && { sort: JSON.stringify(params.sort) })
  };

  const { data } = useSuspenseQuery(ordersQueryOptions(filters));

  const { table } = useDataTable({
    data: data.items,
    columns,
    pageCount: Math.ceil(data.total / params.perPage),
    shallow: true,
    debounceMs: 500,
    initialState: { columnPinning: { right: ['actions'] } }
  });

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}

export function OrderTableSkeleton() {
  return (
    <div className='space-y-4 p-4'>
      <Skeleton className='h-10 w-full' />
      <Skeleton className='h-96 w-full' />
    </div>
  );
}
```

**Column definitions** (`orders-table/columns.tsx`):

Each column needs `id`, `accessorKey` (or `accessorFn`), `header` with `DataTableColumnHeader`, and optionally `meta` for filtering + `enableColumnFilter: true`.

```tsx
export const columns: ColumnDef<Order>[] = [
  {
    id: 'customer',
    accessorKey: 'customer',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Customer' />,
    meta: { label: 'Customer', placeholder: 'Search...', variant: 'text', icon: Icons.text },
    enableColumnFilter: true
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Status' />,
    cell: ({ cell }) => (
      <Badge variant='outline' className='capitalize'>
        {cell.getValue<string>()}
      </Badge>
    ),
    enableColumnFilter: true,
    meta: { label: 'Status', variant: 'multiSelect', options: STATUS_OPTIONS }
  },
  { id: 'actions', cell: ({ row }) => <CellAction data={row.original} /> }
];
```

Filter `meta.variant` options: `text`, `number`, `range`, `date`, `dateRange`, `select`, `multiSelect`, `boolean`. For multiSelect, provide `options: { value, label, icon? }[]`.

**Cell actions** (`orders-table/cell-action.tsx`):

Pattern: `DropdownMenu` with edit/delete items + `AlertModal` for delete confirmation + `useMutation` for the delete API call.

```tsx
import { deleteOrderMutation } from '../../api/mutations';

export const CellAction: React.FC<{ data: Order }> = ({ data }) => {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteMutation = useMutation(deleteOrderMutation);
  return (
    <>
      <AlertModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() =>
          deleteMutation.mutate(data.id, {
            onSuccess: () => {
              toast.success('Deleted');
              setDeleteOpen(false);
            }
          })
        }
        loading={deleteMutation.isPending}
      />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' className='h-8 w-8 p-0'>
            <Icons.ellipsis className='h-4 w-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => router.push(`/dashboard/orders/${data.id}`)}>
            <Icons.edit className='mr-2 h-4 w-4' /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDeleteOpen(true)}>
            <Icons.trash className='mr-2 h-4 w-4' /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
```

For **sheet-based editing**, replace `router.push` with opening a `<FormSheet>` — see the Forms section below.

### Step 5: Page Route (`src/app/dashboard/<name>/page.tsx`)

```tsx
import PageContainer from '@/components/layout/page-container';
import OrderListingPage from '@/features/orders/components/order-listing';
import { searchParamsCache } from '@/lib/searchparams';
import type { SearchParams } from 'nuqs/server';

export const metadata = { title: 'Dashboard: Orders' };
type PageProps = { searchParams: Promise<SearchParams> };

export default async function Page(props: PageProps) {
  const searchParams = await props.searchParams;
  searchParamsCache.parse(searchParams);

  return (
    <PageContainer
      scrollable={false}
      pageTitle='Orders'
      pageDescription='Manage your orders.'
      pageHeaderAction={/* Add button — Link or SheetTrigger */}
    >
      <OrderListingPage />
    </PageContainer>
  );
}
```

**PageContainer props**: `scrollable`, `pageTitle`, `pageDescription`, `pageHeaderAction` (React node for the top-right button), `infoContent` (help sidebar), `access` + `accessFallback` (RBAC gating).

**Detail/Edit page** (`src/app/dashboard/<name>/[id]/page.tsx`):

```tsx
import PageContainer from '@/components/layout/page-container';
import OrderViewPage from '@/features/orders/components/order-view-page';

export const metadata = { title: 'Dashboard: Order Details' };
type PageProps = { params: Promise<{ id: string }> };

export default async function Page(props: PageProps) {
  const { id } = await props.params;
  return (
    <PageContainer scrollable pageTitle='Order Details'>
      <OrderViewPage orderId={id} />
    </PageContainer>
  );
}
```

**View page component** (client — handles new vs edit):

```tsx
'use client';
import { useSuspenseQuery } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { orderByIdOptions } from '../api/queries';
import OrderForm from './order-form';

export default function OrderViewPage({ orderId }: { orderId: string }) {
  if (orderId === 'new') return <OrderForm initialData={null} pageTitle='Create Order' />;
  const { data } = useSuspenseQuery(orderByIdOptions(orderId));
  if (!data) notFound();
  return <OrderForm initialData={data} pageTitle='Edit Order' />;
}
```

### Step 6: Search Params (`src/lib/searchparams.ts`)

Add any new filter keys. Existing params: `page`, `perPage`, `name`, `gender`, `category`, `role`, `sort`.

### Step 7: Navigation (`src/config/nav-config.ts`)

```tsx
{ title: 'Orders', url: '/dashboard/orders', icon: 'product', items: [] }
```

### Step 8: Icons (`src/components/icons.tsx`)

To register a new icon, import from `@tabler/icons-react` and add to the `Icons` object:

```tsx
import { IconShoppingCart } from '@tabler/icons-react';
export const Icons = { /* ...existing */ cart: IconShoppingCart };
```

Never import `@tabler/icons-react` anywhere else. Always use `Icons.keyName`.

**Existing icon keys** (partial): `dashboard`, `product`, `kanban`, `chat`, `forms`, `user`, `teams`, `billing`, `settings`, `add`, `edit`, `trash`, `search`, `check`, `close`, `clock`, `ellipsis`, `text`, `calendar`, `upload`, `spinner`, `chevronDown/Left/Right/Up`, `sun`, `moon`, `palette`, `pro`, `workspace`, `notification`.

---

## Forms

Forms use **TanStack Form + Zod** with `useAppForm` + `useFormFields<T>()` and `useMutation` for submission. See [references/forms-guide.md](references/forms-guide.md) for all field types, validation strategies, multi-step forms, and advanced patterns.

### Page Form (Create/Edit on a dedicated route)

The full pattern is shown in Steps 1-4 above. The key structure:

1. **Schema** — Zod schema + inferred type in `schemas/<name>.ts`
2. **Form component** — `useAppForm({ defaultValues, validators: { onSubmit: schema }, onSubmit })` + `useFormFields<T>()` for typed fields
3. **Mutations** — `useMutation(createOrderMutation)` from `api/mutations.ts`; add UI callbacks per call: `mutate(value, { onSuccess: () => { toast(); router.push() } })` — spreading a new `onSuccess` into `useMutation` would replace the shared cache invalidation
4. **View page** — client component that checks `id === 'new'` for create vs `useSuspenseQuery(byIdOptions)` for edit

### Sheet Form (Inline create/edit in a side panel)

For features where a separate page is overkill. The sheet manages open state; the form uses a `form` attribute to connect to the sheet footer's submit button.

```tsx
'use client';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export function OrderFormSheet({
  order,
  open,
  onOpenChange
}: {
  order?: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = !!order;
  const createMutation = useMutation(createOrderMutation);
  const updateMutation = useMutation(updateOrderMutation);
  const isPending = createMutation.isPending || updateMutation.isPending;
  const form = useAppForm({
    defaultValues: { customer: order?.customer ?? '' /* ... */ } as OrderFormValues,
    validators: { onSubmit: orderSchema },
    onSubmit: async ({ value }) => {
      if (isEdit && order) {
        await updateMutation.mutateAsync(
          { id: order.id, values: value },
          { onSuccess: () => onOpenChange(false) }
        );
      } else {
        await createMutation.mutateAsync(value, {
          onSuccess: () => onOpenChange(false)
        });
      }
    }
  });
  const { FormTextField, FormSelectField } = useFormFields<OrderFormValues>();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='flex flex-col'>
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit' : 'New'} Order</SheetTitle>
        </SheetHeader>
        <div className='flex-1 overflow-auto'>
          <form.AppForm>
            <form.Form id='order-sheet-form' className='space-y-4'>
              <FormTextField name='customer' label='Customer' required />
              <FormSelectField name='status' label='Status' required options={STATUS_OPTIONS} />
            </form.Form>
          </form.AppForm>
        </div>
        <SheetFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type='submit' form='order-sheet-form' disabled={isPending}>
            {isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

For cell actions, add `const [editOpen, setEditOpen] = useState(false)` and render `<OrderFormSheet order={data} open={editOpen} onOpenChange={setEditOpen} />` with a `<DropdownMenuItem onClick={() => setEditOpen(true)}>`. For the page header "Add" button, create a trigger component that manages `open` state and renders the sheet.

**Available field components** from `useFormFields<T>()`: `FormTextField`, `FormTextareaField`, `FormSelectField`, `FormCheckboxField`, `FormSwitchField`, `FormRadioGroupField`, `FormSliderField`, `FormFileUploadField`.

---

## Data Fetching with React Query

The pattern is: server prefetch → HydrationBoundary → client useSuspenseQuery.

1. **Server**: `void queryClient.prefetchQuery(options)` — fire-and-forget during SSR streaming
2. **Client**: `useSuspenseQuery(options)` — picks up dehydrated data, suspends until resolved
3. **HydrationBoundary + dehydrate**: bridges server cache → client cache
4. **Suspense fallback**: skeleton shown while data streams

**Why `useSuspenseQuery` not `useQuery`:** `useQuery` doesn't integrate with Suspense — it shows loading even when data is prefetched. `useSuspenseQuery` picks up the dehydrated pending query. Once cached (within `staleTime: 60s`), subsequent visits are instant.

**Mutations** use `mutationOptions` + `getQueryClient()` in `mutations.ts`; the client calls the Route Handler via `apiClient`:

```tsx
// In mutations.ts — shared config
export const createOrderMutation = mutationOptions({
  mutationFn: (data: OrderMutationPayload) =>
    apiClient<{ id: string }>('/orders', { method: 'POST', body: JSON.stringify(data) }),
  onSuccess: () => {
    getQueryClient().invalidateQueries({ queryKey: orderKeys.all });
  }
});

// In component — callbacks on mutate() run in addition to mutationOptions.onSuccess
const mutation = useMutation(createOrderMutation);
mutation.mutate(data, { onSuccess: () => toast.success('Created') });
```

See [references/query-abstractions.md](references/query-abstractions.md) for why `mutationOptions`/`queryOptions` are the right abstraction over custom hooks.

---

## Navigation & RBAC

Configure in `src/config/nav-config.ts`. Items are filtered client-side in `src/hooks/use-nav.ts` (synchronous, UX only — no auth / org lookups).

**Access control properties** on nav items (vestigial — org-based checks no longer resolve under the single-admin model; prefer leaving `access` off and gate admin-only entries server-side via `isAdmin`):

- `requireOrg: boolean` — requires an active organization (unused; no org plugin)
- `permission: string` — requires a specific permission (unused)
- `role: string` — requires a specific role (unused)
- `plan: string` — requires subscription plan (server-side)
- `feature: string` — requires feature flag (server-side)

Items without `access` are visible to everyone. All client-side checks are synchronous — no loading states. Real authorization is server-side (`verifySession` / `isAdmin`; see [docs/auth.md](../../../docs/auth.md)).

---

## Themes

See [references/theming-guide.md](references/theming-guide.md) for the complete guide. Quick steps:

1. Create `src/styles/themes/<name>.css` with OKLCH color tokens + `@theme inline` block
2. Import in `src/styles/theme.css`
3. Register in `THEMES` array in `src/components/themes/theme.config.ts`
4. (Optional) Add Google Fonts in `src/components/themes/font.config.ts`

---

## Code Conventions

- **`cn()`** for class merging — never concatenate className strings
- **Server components by default** — only add `'use client'` when needed
- **React Query** — `void prefetchQuery()` on server + `useSuspenseQuery` on client
- **API layer** — `types.ts` → `service.ts` (server-only) → `queries.ts` / `mutations.ts` (`apiClient`) → Route Handler; `queryOptions`/`mutationOptions` as base abstractions (not custom hooks); `getQueryClient()` in mutations (not `useQueryClient()`); key factories (`entityKeys.all/list/detail`); **client** components never import `service.ts` — Server Components / Route Handlers call it directly
- **nuqs** — `searchParamsCache` on server, `useQueryStates` on client with `shallow: true`
- **Icons** — only from `@/components/icons`, never from `@tabler/icons-react` directly
- **Forms** — `useAppForm` + `useFormFields<T>()` from `@/components/ui/tanstack-form`
- **Page headers** — `PageContainer` props, never import `<Heading>` manually
- **Sort parser** — use `getSortingStateParser` from `@/lib/parsers` (same parser as `useDataTable`)
- **Formatting** — single quotes, JSX single quotes, no trailing comma, 2-space indent
