import { createTRPCClient } from '@trpc/client';
import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import type { RouterRecord } from '@trpc/server/unstable-core-do-not-import';
import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';
import { localLink } from '../src';

const { router: createRouter, procedure } = initTRPC.create({ isServer: true });

const schema = <T>(v: unknown): T => v as T;

function createClient<T extends RouterRecord>(record: T) {
  const router = createRouter(record);
  return createTRPCClient<typeof router>({ links: [localLink(router)] });
}

function withResolvers<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => ([resolve, reject] = [resolveFn, rejectFn]));
  return { promise, resolve, reject };
}

test('query', async () => {
  const client = createClient({
    greet: procedure.input(schema<{ name: string }>).query(({ input }) => `Hello, ${input.name}`),
  });
  expect(client.greet.query({ name: 'world' })).resolves.toBe('Hello, world');
});

test('mutation', async () => {
  const client = createClient({
    greet: procedure.input(schema<{ name: string }>).mutation(({ input }) => `Hello, ${input.name}`),
  });
  expect(client.greet.mutate({ name: 'world' })).resolves.toBe('Hello, world');
});

describe('subscribe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('basic', async () => {
    const client = createClient({
      greet: procedure.input(schema<{ name: string }>).subscription(({ input }) =>
        observable((observer) => {
          observer.next(`Hello, ${input.name}`);
          observer.complete();
        })
      ),
    });
    const { promise, resolve } = withResolvers();
    const onDataFn = vi.fn();
    client.greet.subscribe(
      { name: 'world' },
      {
        onData: onDataFn,
        onComplete: resolve,
      }
    );
    await promise;
    expect(onDataFn).toBeCalledTimes(1);
    expect(onDataFn).toBeCalledWith('Hello, world');
  });

  test('unsubscribe', async () => {
    const cleanupFn = vi.fn();
    const client = createClient({
      greet: procedure.subscription(() =>
        observable((observer) => {
          let index = 0;
          const timer = setInterval(() => observer.next(index++), 1000);
          return () => {
            cleanupFn();
            observer.complete();
            clearInterval(timer);
          };
        })
      ),
    });
    const { promise, resolve } = withResolvers();
    const onDataFn = vi.fn();
    const { unsubscribe } = client.greet.subscribe(undefined, {
      onData: onDataFn,
      onComplete: resolve,
    });
    setTimeout(unsubscribe, 2500);

    await vi.advanceTimersByTimeAsync(1000);
    expect(onDataFn).toBeCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(onDataFn).toBeCalledTimes(2);
    expect(cleanupFn).not.toBeCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onDataFn).toBeCalledTimes(2);
    expect(cleanupFn).toBeCalled();

    await promise;
    expect(onDataFn).toBeCalledTimes(2);
    expect(onDataFn).toBeCalledWith(0);
  });
});
