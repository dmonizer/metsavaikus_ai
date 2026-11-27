import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWorldInitError, startAsyncWorldInit } from './worldInit';

function deferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('texture loading rejection triggers cleanup and error reporting without unhandled rejections', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const engineDef = deferred<{ isWasmActive: boolean }>();
    let cleanupCount = 0;
    let built = false;
    const errors: string[] = [];

    const handle = startAsyncWorldInit({
      loadComputeEngine: () => engineDef.promise,
      loadTextures: () => Promise.reject(new Error('Failed to load texture image: thatch_mossy.jpg')),
      buildWorld: () => {
        built = true;
      },
      cleanupResources: () => {
        cleanupCount += 1;
      },
      onError: (msg) => {
        errors.push(msg);
      },
      isDisposed: () => false,
    });

    await handle.done;
    assert.equal(built, false);
    assert.equal(cleanupCount, 1);
    assert.deepEqual(errors, ['Failed to load texture image: thatch_mossy.jpg']);

    // Sibling engine promise resolves later cleanly
    engineDef.resolve({ isWasmActive: true });
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(unhandled.length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('late-settling texture resource is disposed if compute engine rejected first', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const texDef = deferred<{ dispose: () => void }>();
    let texDisposed = 0;
    let cleanupCount = 0;
    const errors: string[] = [];

    const handle = startAsyncWorldInit({
      loadComputeEngine: () => Promise.reject(new Error('WASM compile boom')),
      loadTextures: () => texDef.promise,
      buildWorld: () => {},
      cleanupResources: () => {
        cleanupCount += 1;
      },
      onError: (msg) => errors.push(msg),
      isDisposed: () => false,
    });

    await handle.done;
    assert.equal(cleanupCount, 1);
    assert.deepEqual(errors, ['WASM compile boom']);
    assert.equal(texDisposed, 0);

    // Textures finish loading after Promise.all has already failed -> must still dispose immediately
    texDef.resolve({
      dispose: () => {
        texDisposed += 1;
      },
    });
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(texDisposed, 1);
    assert.equal(unhandled.length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('synchronous world-builder exception releases textures, invokes cleanup, and reports error', async () => {
  let texDisposed = 0;
  let cleanupCount = 0;
  const errors: string[] = [];

  const handle = startAsyncWorldInit({
    loadComputeEngine: () => Promise.resolve({ isWasmActive: true }),
    loadTextures: () =>
      Promise.resolve({
        dispose: () => {
          texDisposed += 1;
        },
      }),
    buildWorld: () => {
      throw new Error('TerrainChunkManager exploded during prewarm');
    },
    cleanupResources: () => {
      cleanupCount += 1;
    },
    onError: (msg) => errors.push(msg),
    isDisposed: () => false,
  });

  await handle.done;
  assert.ok(texDisposed >= 1);
  assert.equal(cleanupCount, 1);
  assert.deepEqual(errors, ['TerrainChunkManager exploded during prewarm']);
});

test('unmount while pending suppresses error/build callbacks and disposes late textures', async () => {
  const texDef = deferred<{ dispose: () => void }>();
  const engineDef = deferred<{ isWasmActive: boolean }>();
  let disposed = false;
  let texDisposed = 0;
  let built = false;
  const errors: string[] = [];

  const handle = startAsyncWorldInit({
    loadComputeEngine: () => engineDef.promise,
    loadTextures: () => texDef.promise,
    buildWorld: () => {
      built = true;
    },
    cleanupResources: () => {},
    onError: (msg) => errors.push(msg),
    isDisposed: () => disposed,
  });

  // Simulate React unmount while promises are still in flight
  disposed = true;
  handle.cancel();

  engineDef.resolve({ isWasmActive: true });
  texDef.resolve({
    dispose: () => {
      texDisposed += 1;
    },
  });

  await handle.done;
  assert.equal(built, false);
  assert.equal(errors.length, 0);
  assert.ok(texDisposed >= 1);
});

test('retry after failure builds exactly one working world without stale side effects', async () => {
  let cleanups = 0;
  let readyBuilds = 0;
  const errors: string[] = [];

  const first = startAsyncWorldInit({
    loadComputeEngine: () => Promise.resolve({ isWasmActive: true }),
    loadTextures: () => Promise.reject('image decode error'),
    buildWorld: () => {
      readyBuilds += 1;
    },
    cleanupResources: () => {
      cleanups += 1;
    },
    onError: (msg) => errors.push(msg),
    isDisposed: () => false,
  });
  await first.done;

  const second = startAsyncWorldInit({
    loadComputeEngine: () => Promise.resolve({ isWasmActive: true }),
    loadTextures: () => Promise.resolve({ dispose: () => {} }),
    buildWorld: () => {
      readyBuilds += 1;
    },
    cleanupResources: () => {
      cleanups += 1;
    },
    onError: (msg) => errors.push(msg),
    isDisposed: () => false,
  });
  await second.done;

  assert.equal(cleanups, 1);
  assert.equal(readyBuilds, 1);
  assert.deepEqual(errors, ['image decode error']);
});

test('formatWorldInitError produces clean fallback messages for non-Error rejections', () => {
  assert.equal(formatWorldInitError(new Error('boom')), 'boom');
  assert.equal(formatWorldInitError('plain error'), 'plain error');
  assert.equal(formatWorldInitError({ type: 'error' }), 'Asset load failed (error)');
  assert.match(formatWorldInitError(null), /Unexpected error/);
});
