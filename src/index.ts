import { TRPCClientError, TRPCLink } from '@trpc/client';
import { AnyTRPCRouter, callTRPCProcedure } from '@trpc/server';
import { observable } from '@trpc/server/observable';

export function localLink<TRouter extends AnyTRPCRouter>(router: TRouter): TRPCLink<TRouter> {
  const { procedures } = router._def;
  return () =>
    ({ op }) => {
      const { type, path, context, input } = op;

      return observable((observer) => {
        const ac = new AbortController();
        callTRPCProcedure({
          procedures,
          path,
          getRawInput: () => Promise.resolve(input),
          type,
          ctx: context,
          input,
        })
          .then((response) => {
            if (type !== 'subscription') {
              observer.next({ result: { type: 'data', data: response } });
              observer.complete();
            } else {
              observer.next({ context, result: { type: 'started' } });
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
          })
          .catch((err) => observer.error(TRPCClientError.from(err)));
        return () => ac.abort();
      });
    };
}
