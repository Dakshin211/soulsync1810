// Search suggestions using proxy endpoint (no YouTube Data API)

const cache = new Map<string, { data: string[]; timestamp: number }>();
const sessionCache = new Map<string, { data: string[]; timestamp: number }>();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

function getCachedData(cacheKey: string): string[] | null {
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  return null;
}

function setCachedData(cacheKey: string, data: string[]) {
  cache.set(cacheKey, { data, timestamp: Date.now() });
}

// Fetch from your Vercel API proxy endpoint
async function fetchSuggestions(query: string): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    // Call your Vercel serverless function
    const response = await fetch(
      `/api/suggestions?q=${encodeURIComponent(query)}`,
      { signal: controller.signal }
    );
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error('Suggestions endpoint failed');
    }

    const data = await response.json();
    return Array.isArray(data) ? data.slice(0, 8) : [];
  } catch (error) {
    console.warn('Suggestions fetch failed:', error);
    return [];
  }
}

export async function getSearchSuggestions(query: string): Promise<string[]> {
  if (!query.trim()) return [];
  
  const cacheKey = `suggestions:${query.toLowerCase()}`;
  
  // Check both caches
  const cached = getCachedData(cacheKey);
  if (cached) {
    return cached;
  }
  
  const sessionCached = sessionCache.get(cacheKey);
  if (sessionCached && Date.now() - sessionCached.timestamp < CACHE_DURATION) {
    return sessionCached.data;
  }

  // Check sessionStorage
  try {
    const stored = sessionStorage.getItem(cacheKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Date.now() - parsed.timestamp < CACHE_DURATION) {
        sessionCache.set(cacheKey, parsed);
        return parsed.data;
      }
    }
  } catch (e) {}

  // Fetch from proxy endpoint
  const suggestions = await fetchSuggestions(query);
  
  if (suggestions.length > 0) {
    setCachedData(cacheKey, suggestions);
    sessionCache.set(cacheKey, { data: suggestions, timestamp: Date.now() });
    
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify({ data: suggestions, timestamp: Date.now() }));
    } catch (e) {
      console.warn('Failed to save to sessionStorage:', e);
    }
  }
  
  return suggestions;
}
