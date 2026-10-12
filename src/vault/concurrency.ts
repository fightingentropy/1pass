// Chunks in flight at once for a single attachment transfer (upload, re-key,
// backup). Each staged chunk is its own server object and commit verifies the
// complete ordered hash set, so chunks never need to arrive in index order.
export const ATTACHMENT_TRANSFER_CONCURRENCY = 4;

// Runs `task` over `items` with at most `limit` tasks in flight and resolves
// to the results in input order. After the first failure no further items are
// started; tasks already in flight are left to settle so a caller's cleanup
// (abort/delete) never races its own chunk work, then the first error is
// rethrown.
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  const workerCount = Math.min(
    Math.max(1, Math.floor(limit) || 1),
    items.length,
  );
  const failures: unknown[] = [];
  let cursor = 0;

  async function worker() {
    while (failures.length === 0 && cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        failures.push(error);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failures.length > 0) throw failures[0];
  return results;
}
