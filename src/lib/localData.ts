const USER_DATA_CACHE_NAMES = ['nutritrack-off-api', 'nutritrack-off-img', 'nutritrack-img'] as const;

/** Runtime caches may contain OFF search URLs and user-triggered remote images. */
export async function clearRuntimeDataCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await Promise.all(
    USER_DATA_CACHE_NAMES.map(async (name) => {
      try {
        await caches.delete(name);
      } catch {
        // CacheStorage is best-effort and must not invalidate the atomic localStorage reset.
      }
    }),
  );
}
