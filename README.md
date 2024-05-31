```ts
import { createTRPCClient } from '@trpc/client';
import { localLink } from 'trpc-local-link';

import { type AppRouter, appRouter } from '@/api';

export const trpcClient = createTRPCClient<AppRouter>({ links: [localLink(appRouter)] });
```
