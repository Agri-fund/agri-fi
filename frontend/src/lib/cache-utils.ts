/**
 * Cache Utilities
 *
 * Handles interaction with service worker cache, including invalidation on logout.
 */

/**
 * Clear all service worker caches (API and runtime).
 * Should be called on user logout to remove sensitive cached data.
 *
 * @returns {Promise<void>}
 *
 * @example
 * // On logout
 * await clearServiceWorkerCache();
 */
export async function clearServiceWorkerCache(): Promise<void> {
  if ('serviceWorker' in navigator) {
    try {
      // Get active service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Send message to service worker to clear caches
      if (registration.active) {
        registration.active.postMessage({
          type: 'CLEAR_CACHE',
        });

        console.log('[Cache] Service worker cache invalidation triggered');
      }

      // Also clear browser caches directly as a backup
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((name) => {
          if (
            name.startsWith('agri-fi-api') ||
            name.startsWith('agri-fi-runtime')
          ) {
            console.log('[Cache] Deleting cache:', name);
            return caches.delete(name);
          }
        }),
      );

      console.log('[Cache] All caches cleared on logout');
    } catch (error) {
      console.error('[Cache] Failed to clear caches:', error);
      // Don't throw - cache clearing is non-critical
    }
  }
}

/**
 * Get cache statistics for debugging.
 *
 * @returns {Promise<{totalCaches: number, cacheSizes: Record<string, number>}>}
 *
 * @example
 * const stats = await getCacheStats();
 * console.log(`Total caches: ${stats.totalCaches}`);
 */
export async function getCacheStats(): Promise<{
  totalCaches: number;
  cacheSizes: Record<string, number>;
}> {
  if (!('caches' in window)) {
    return { totalCaches: 0, cacheSizes: {} };
  }

  try {
    const cacheNames = await caches.keys();
    const cacheSizes: Record<string, number> = {};

    for (const name of cacheNames) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      cacheSizes[name] = keys.length;
    }

    return {
      totalCaches: cacheNames.length,
      cacheSizes,
    };
  } catch (error) {
    console.error('[Cache] Failed to get cache stats:', error);
    return { totalCaches: 0, cacheSizes: {} };
  }
}
