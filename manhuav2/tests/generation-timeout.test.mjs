import assert from "node:assert/strict";
import test from "node:test";

import { GenerationTimeoutError, remainingGenerationMs, runTimedStage } from "../lib/generation-timeout.ts";

test("timed stage retries once after an aborted attempt", async () => {
  let attempts = 0;
  const result = await runTimedStage({
    stage: "绘制初稿",
    deadline: Date.now() + 200,
    attemptTimeoutMs: 25,
    retries: 1,
  }, async signal => {
    attempts += 1;
    if (attempts === 1) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 100);
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("aborted", "AbortError")); }, { once: true });
      });
    }
    return "完成";
  });

  assert.equal(result, "完成");
  assert.equal(attempts, 2);
});

test("timed stage stops an operation that ignores AbortSignal", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    runTimedStage({ stage: "视觉评审", deadline: Date.now() + 80, attemptTimeoutMs: 15 }, async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return "too late";
    }),
    error => error instanceof GenerationTimeoutError && error.stage === "视觉评审",
  );
  assert.ok(Date.now() - startedAt < 70);
});

test("shared deadline reports no remaining budget after expiry", () => {
  assert.equal(remainingGenerationMs(Date.now() - 1), 0);
});
