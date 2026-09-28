'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, isTerminalJobStatus, type JobStatusResponse } from '@shade/shared';
import { jobs as jobsApi } from '../endpoints';
import { isAbort } from '../api';

/**
 * Follows a job until it reaches a terminal state.
 *
 * Three properties this hook is responsible for, each of which is a way a naive
 * polling loop goes wrong:
 *
 * **It stops.** The moment the server reports a terminal status, polling ends.
 * A loop that keeps asking after COMPLETED burns the anonymous quota's
 * rate limit and, worse, can overwrite a rendered result with a later, emptier
 * response.
 *
 * **It backs off.** The first few polls are fast because a mocked job really
 * does finish in a second or two, and a user watching a progress bar deserves
 * sub-second feedback. Once the job has been running long enough that it is
 * clearly not instant, the interval stretches — so a genuinely slow document
 * does not turn into hundreds of requests.
 *
 * **It survives a blip.** One failed poll is not a failed job. The loop
 * tolerates consecutive failures and only surfaces an error after several, so
 * a dropped packet or a dev-server restart does not blank the screen while the
 * work is still running perfectly well on the server.
 */

/** Milliseconds between polls, indexed by attempt and clamped to the last entry. */
const POLL_SCHEDULE_MS = [600, 800, 1100, 1500, 2000, 2500] as const;

/** Consecutive failures tolerated before the loop gives up and reports. */
const MAX_CONSECUTIVE_FAILURES = 4;

export interface UseJobPollResult {
  status: JobStatusResponse | null;
  job: JobStatusResponse['job'] | null;
  /** Non-null only on the poll that first observed COMPLETED. */
  result: JobStatusResponse['result'];
  error: ApiError | null;
  /** True while a poll is scheduled or in flight. */
  isPolling: boolean;
  /** Cancels polling without unmounting — used when the user leaves the job. */
  stop: () => void;
}

export function useJobPoll(jobId: string | null): UseJobPollResult {
  const [status, setStatus] = useState<JobStatusResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const stopped = useRef(false);
  const failures = useRef(0);

  const stop = useCallback(() => {
    stopped.current = true;
    if (timer.current) clearTimeout(timer.current);
    controller.current?.abort();
    timer.current = null;
    setIsPolling(false);
  }, []);

  useEffect(() => {
    if (!jobId) {
      setStatus(null);
      setError(null);
      setIsPolling(false);
      return;
    }

    stopped.current = false;
    failures.current = 0;
    let attempt = 0;

    setIsPolling(true);
    // A new job id means the previous job's result is no longer the subject.
    // Clearing here is what stops the workspace from briefly rendering the last
    // document's Markdown under the new document's filename.
    setStatus(null);
    setError(null);

    const tick = async () => {
      if (stopped.current) return;

      const abort = new AbortController();
      controller.current = abort;

      try {
        const next = await jobsApi.status(jobId, abort.signal);
        if (stopped.current) return;

        failures.current = 0;
        setStatus(next);
        setError(null);

        if (isTerminalJobStatus(next.job.status)) {
          stopped.current = true;
          setIsPolling(false);
          return;
        }
      } catch (cause) {
        // An aborted poll is this hook cleaning up after itself, not a failure.
        if (isAbort(cause) || stopped.current) return;

        failures.current += 1;
        if (failures.current >= MAX_CONSECUTIVE_FAILURES) {
          setError(
            cause instanceof ApiError
              ? cause
              : new ApiError(0, {
                  code: 'SERVICE_UNAVAILABLE',
                  message: 'We lost contact with the processing service.',
                }),
          );
          stopped.current = true;
          setIsPolling(false);
          return;
        }
      }

      const delay = POLL_SCHEDULE_MS[Math.min(attempt, POLL_SCHEDULE_MS.length - 1)];
      attempt += 1;
      timer.current = setTimeout(() => void tick(), delay);
    };

    void tick();

    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
      controller.current?.abort();
      timer.current = null;
    };
  }, [jobId]);

  return {
    status,
    job: status?.job ?? null,
    // `result` is only present on a COMPLETED response, so passing it straight
    // through would hand the UI a non-null result for a FAILED job whose last
    // successful poll happened to include one. The status check makes the
    // contract explicit: a result exists only when the job says it does.
    result: status?.job.status === 'COMPLETED' ? status.result : null,
    error,
    isPolling,
    stop,
  };
}
