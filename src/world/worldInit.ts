export interface DisposableResource {
  dispose: () => void;
}

export interface AsyncWorldInitParams<TEngine, TTextures extends DisposableResource> {
  loadComputeEngine: () => Promise<TEngine>;
  loadTextures: () => Promise<TTextures>;
  buildWorld: (engine: TEngine, textures: TTextures) => void | Promise<void>;
  cleanupResources: () => void;
  onError: (message: string) => void;
  isDisposed: () => boolean;
}

export interface AsyncWorldInitHandle {
  cancel: () => void;
  done: Promise<void>;
}

export function formatWorldInitError(err: unknown): string {
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message.trim();
  }
  if (typeof err === 'string' && err.trim().length > 0) {
    return err.trim();
  }
  if (err && typeof err === 'object' && 'type' in err) {
    const evType = String((err as { type?: unknown }).type ?? '').trim();
    if (evType) {
      return `Asset load failed (${evType})`;
    }
  }
  return 'Unexpected error while initializing the 3D world.';
}

/**
 * Coordinates asynchronous engine + texture loading and staged world construction
 * with full failure handling, sibling-promise disposal, and unmount cancellation safety.
 */
export function startAsyncWorldInit<TEngine, TTextures extends DisposableResource>(
  params: AsyncWorldInitParams<TEngine, TTextures>
): AsyncWorldInitHandle {
  let cancelled = false;
  let settledTextures: TTextures | null = null;
  let builtWorldStarted = false;

  const disposeSettledTextures = () => {
    if (settledTextures) {
      try {
        settledTextures.dispose();
      } catch {
        // Ignore secondary errors while releasing partially loaded textures
      }
      settledTextures = null;
    }
  };

  let enginePromise: Promise<TEngine>;
  try {
    enginePromise = Promise.resolve(params.loadComputeEngine());
  } catch (err) {
    enginePromise = Promise.reject(err);
  }

  let texturesPromise: Promise<TTextures>;
  try {
    texturesPromise = Promise.resolve(params.loadTextures()).then((loadedTextures) => {
      if (cancelled || params.isDisposed()) {
        try {
          loadedTextures.dispose();
        } catch {
          // Ignore secondary errors while releasing cancelled textures
        }
        return loadedTextures;
      }
      settledTextures = loadedTextures;
      return loadedTextures;
    });
  } catch (err) {
    texturesPromise = Promise.reject(err);
  }

  // Prevent late sibling rejections from becoming unhandledRejection events if Promise.all
  // already rejected on the other promise.
  enginePromise.catch(() => {});
  texturesPromise.catch(() => {});

  const done = Promise.all([enginePromise, texturesPromise]).then(
    async ([engine, loadedTextures]) => {
      if (cancelled || params.isDisposed()) {
        disposeSettledTextures();
        return;
      }
      builtWorldStarted = true;
      try {
        await params.buildWorld(engine, loadedTextures);
      } catch (err) {
        if (cancelled || params.isDisposed()) return;
        cancelled = true;
        disposeSettledTextures();
        params.cleanupResources();
        if (!params.isDisposed()) {
          params.onError(formatWorldInitError(err));
        }
      }
    },
    (err) => {
      if (cancelled || params.isDisposed()) return;
      cancelled = true;
      disposeSettledTextures();
      params.cleanupResources();
      if (!params.isDisposed()) {
        params.onError(formatWorldInitError(err));
      }
    }
  );

  return {
    cancel: () => {
      cancelled = true;
      if (!builtWorldStarted) {
        disposeSettledTextures();
      }
    },
    done,
  };
}
