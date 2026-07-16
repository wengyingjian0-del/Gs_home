export class GenerationTimeoutError extends Error {
  readonly code = "GENERATION_TIMEOUT";
  readonly stage: string;

  constructor(stage: string) {
    super(`${stage}超时`);
    this.stage = stage;
    this.name = "GenerationTimeoutError";
  }
}

export function isTimeoutLikeError(error: unknown) {
  return error instanceof GenerationTimeoutError
    || (error instanceof DOMException && error.name === "AbortError")
    || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name));
}

export function remainingGenerationMs(deadline: number) {
  return Math.max(0, deadline - Date.now());
}

type TimedStageOptions = {
  stage: string;
  deadline: number;
  attemptTimeoutMs: number;
  retries?: number;
  reserveMs?: number;
  retryMinimumMs?: number;
  onAttempt?: (attempt: number, maxAttempts: number) => void | Promise<void>;
};

export async function runTimedStage<T>(
  options: TimedStageOptions,
  operation: (signal: AbortSignal, attempt: number) => Promise<T>,
): Promise<T> {
  const maxAttempts = Math.max(1, (options.retries ?? 0) + 1);
  const reserveMs = Math.max(0, options.reserveMs ?? 0);
  const retryMinimumMs = Math.max(1, options.retryMinimumMs ?? 5_000);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const available = options.deadline - Date.now() - reserveMs;
    if (available <= 0) throw new GenerationTimeoutError(options.stage);
    const laterAttempts = maxAttempts - attempt;
    const retryReserve = Math.min(retryMinimumMs * laterAttempts, Math.floor(available * laterAttempts / (laterAttempts + 1)));
    const timeoutMs = Math.max(1, Math.min(options.attemptTimeoutMs, available - retryReserve));
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new GenerationTimeoutError(options.stage));
      }, timeoutMs);
    });

    try {
      await options.onAttempt?.(attempt, maxAttempts);
      return await Promise.race([operation(controller.signal, attempt), timeout]);
    } catch (error) {
      lastError = error;
      if (!isTimeoutLikeError(error) || attempt === maxAttempts) throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new GenerationTimeoutError(options.stage);
}
