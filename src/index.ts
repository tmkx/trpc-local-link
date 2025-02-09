import { Operation, TRPCClientError, TRPCLink } from '@trpc/client';
import { AnyTRPCRouter, callTRPCProcedure } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { MaybePromise, isAsyncIterable } from '@trpc/server/unstable-core-do-not-import';

export interface LocalLinkOptions<TRouter extends AnyTRPCRouter> {
  router: TRouter;
  context?: (opts: { op: Operation<unknown> }) => MaybePromise<Record<string, unknown> | null>;
}

export function localLink<TRouter extends AnyTRPCRouter>(opts: TRouter | LocalLinkOptions<TRouter>): TRPCLink<TRouter> {
  const { router, context: getContext } =
    'router' in opts ? opts : ({ router: opts } satisfies LocalLinkOptions<TRouter>);
  return () =>
    ({ op }) => {
      const { type, path, context, input, signal } = op;

      return observable((observer) => {
        const ac = new AbortController();
        Promise.resolve(getContext ? getContext({ op }) : null)
          .then((customContext) =>
            callTRPCProcedure({
              _def: router._def,
              signal: signal || undefined,
              path,
              getRawInput: () => Promise.resolve(input),
              type,
              ctx: { signal: ac.signal, ...context, ...customContext },
              input,
            })
          )
          .then(async (response) => {
            if (type !== 'subscription') {
              observer.next({ result: { type: 'data', data: response } });
              observer.complete();
            } else {
              observer.next({ context, result: { type: 'started' } });

              if (isAsyncIterable(response)) {
                try {
                  ac.signal.addEventListener('abort', () => {
                    observer.error(TRPCClientError.from(new Error('Aborted')));
                  });
                  for await (const chunk of response) {
                    if (ac.signal.aborted) return;
                    observer.next({ context, result: { type: 'data', data: chunk } });
                  }
                  observer.next({ context, result: { type: 'stopped' } });
                  observer.complete();
                } catch (err: any) {
                  observer.error(TRPCClientError.from(err));
                }
              } else {
                const { unsubscribe } = response.subscribe({
                  next(data: unknown) {
                    observer.next({ context, result: { type: 'data', data } });
                  },
                  error(err: any) {
                    observer.error(TRPCClientError.from(err));
                  },
                  complete() {
                    observer.next({ context, result: { type: 'stopped' } });
                    observer.complete();
                  },
                });
                ac.signal.addEventListener('abort', unsubscribe);
              }
            }
          })
          .catch((err) => observer.error(TRPCClientError.from(err)));
        return () => {
          ac.abort();
        };
      });
    };
}
