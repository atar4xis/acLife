// flat-maps in small batches, yielding between them so the UI stays responsive
export async function flatMapInBatches<T, U>(
  items: T[],
  fn: (item: T) => U[],
  batchSize: number,
): Promise<U[]> {
  const results: U[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    await new Promise((resolve) => setTimeout(resolve));
    results.push(...items.slice(i, i + batchSize).flatMap(fn));
  }
  return results;
}
