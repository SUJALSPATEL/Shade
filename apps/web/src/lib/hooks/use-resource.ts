'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@shade/shared';
import { isAbort } from '../api';

/**
 * Loads a resource, re-loading when its key changes.
 *
 * The key is a string rather than a dependency array on purpose. `useEffect`
 * compares deps by reference, so a caller writing `useResource(() => get(id), [id])`
 * is one careless inline object away from an infinite fetch loop — a mistake
 * that shows up as a browser tab hammering the API rather than as a test
 * failure. A string key has no such failure mode: if it did not change, the
 * data did not change.
 *
 * The previous value is held while a reload is in flight (`isRefreshing`),
 * which is what lets a filter change keep the old list on screen instead of
 * flashing an empty state and then the same rows back.
 */

export interface UseResourceResult<T> {
  data: T | null;
  error: ApiError | null;
  /** True only for the first load of a given key — never for a reload. */
  isLoading: boolean;
  /** True while a reload of an already-loaded key is in flight. */
  isRefreshing: boolean;
  reload: () => void;
  /** Applies a local update without a round trip (e.g. after a delete). */
  setData: (next: T | null) => void;
}

export function useResource<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
): UseResourceResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);

  // The fetcher closes over render state, so it is a new function every render.
  // Holding it in a ref keeps the effect keyed on `key` alone — otherwise every
  // render would restart the request.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    const isFirstLoad = loadedKey.current !== key;

    if (isFirstLoad) {
      setIsLoading(true);
      setData(null);
      setError(null);
    } else {
      setIsRefreshing(true);
    }

    let active = true;

    fetcherRef
      .current(abort.signal)
      .then((next) => {
        if (!active) return;
        setData(next);
        setError(null);
        loadedKey.current = key;
      })
      .catch((cause: unknown) => {
        // Navigating away mid-request is not a failure.
        if (!active || isAbort(cause)) return;
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError(0, {
                code: 'INTERNAL_ERROR',
                message: 'Something went wrong loading this view.',
              }),
        );
      })
      .finally(() => {
        if (!active) return;
        setIsLoading(false);
        setIsRefreshing(false);
      });

    return () => {
      active = false;
      abort.abort();
    };
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, isLoading, isRefreshing, reload, setData };
}
