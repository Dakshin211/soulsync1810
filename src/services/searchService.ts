// service/searchService.ts
import { searchYouTube } from '@/services/youtubeApi';

export interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}

export interface SearchResult {
  songs: Song[];
  source: 'youtube' | 'ytdlp';
  slow: boolean;
  error?: string;
}

export type SearchMode = 'fast' | 'slow';

// Cache per session
const searchCache = new Map<string, { data: SearchResult; ts: number }>();
const CACHE_MS = 5 * 60 * 1000;

// Primary HTTPS backend (fast)
const YTDLP_PRIMARY = 'https://35.209.154.134.sslip.io/search';
// Fallback backend (slower, cold starts ~50s)
const YTDLP_FALLBACK = 'https://ytdlp-search.onrender.com/search';

// Track active requests to prevent duplicate concurrent searches
const activeRequests = new Map<string, Promise<SearchResult>>();

// Limit concurrent SLOW backend searches (protects cold-start backends)
const MAX_CONCURRENT_SLOW = 6;
let activeSlow = 0;
const slowWaiters: Array<() => void> = [];

async function acquireSlowSlot(waitMs: number): Promise<boolean> {
  if (activeSlow < MAX_CONCURRENT_SLOW) {
    activeSlow++;
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    let done = false;

    const wake = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      activeSlow++;
      resolve(true);
    };

    timer = setTimeout(() => {
      if (done) return;
      done = true;
      const idx = slowWaiters.indexOf(wake);
      if (idx >= 0) slowWaiters.splice(idx, 1);
      resolve(false);
    }, waitMs);

    slowWaiters.push(wake);
  });
}

function releaseSlowSlot() {
  activeSlow = Math.max(0, activeSlow - 1);
  const next = slowWaiters.shift();
  if (next) next();
}

// Render wake-up state - only wake up once per session (with cooldown retry)
let renderWokenUp = false;
let renderWakeupPromise: Promise<void> | null = null;
let lastRenderWarmupAttempt = 0;
const RENDER_WARMUP_COOLDOWN_MS = 2 * 60 * 1000;

// Wake up render backend once in background (no loop, no blocking)
function wakeupRenderBackend() {
  if (renderWokenUp || renderWakeupPromise) return;

  const now = Date.now();
  if (now - lastRenderWarmupAttempt < RENDER_WARMUP_COOLDOWN_MS) return;
  lastRenderWarmupAttempt = now;

  renderWakeupPromise = (async () => {
    try {
      console.log('[Search] Waking up Render fallback in background...');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s max

      await fetch(YTDLP_FALLBACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'test' }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      renderWokenUp = true;
      console.log('[Search] Render fallback is now awake');
    } catch {
      // Silently fail - it's just a warmup (Render may be cold)
      console.log('[Search] Render fallback warmup failed (may still be cold)');
    } finally {
      // Allow retry after cooldown
      renderWakeupPromise = null;
    }
  })();
}

async function fetchFromBackend(
  query: string,
  url: string,
  signal: AbortSignal,
  timeoutMs: number
): Promise<SearchResult> {
  const startTime = Date.now();

  const controller = new AbortController();
  const onAbort = () => controller.abort();

  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', onAbort);

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Backend error: ${response.status}${body ? ` - ${body.slice(0, 120)}` : ''}`);
    }

    const data = await response.json();
    const elapsed = Date.now() - startTime;

    const songs: Song[] = (data.results || []).slice(0, 10).map((item: any) => ({
      id: item.id,
      title: item.title,
      artist: item.artist || 'Unknown',
      thumbnail:
        item.thumbnail || `https://img.youtube.com/vi/${item.id}/hqdefault.jpg`,
      duration: item.duration || 0,
    }));

    return {
      songs,
      source: 'ytdlp' as const,
      slow: elapsed > 5000,
    };
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onAbort);
  }
}

async function fetchFromYtdlp(query: string, signal: AbortSignal): Promise<SearchResult> {
  // Try primary HTTPS backend first (should be fast)
  try {
    console.log('[Search] Trying primary backend...');
    return await fetchFromBackend(query, YTDLP_PRIMARY, signal, 15000);
  } catch (primaryErr: any) {
    console.warn('[Search] Primary backend failed:', primaryErr.message);
  }

  // Fallback backend (Render). Warm it up in background but ALSO attempt it now.
  wakeupRenderBackend();

  try {
    console.log('[Search] Trying Render fallback...');
    // Allow long cold start on first hit
    const res = await fetchFromBackend(query, YTDLP_FALLBACK, signal, 60000);
    renderWokenUp = true;
    return res;
  } catch (fallbackErr: any) {
    console.warn('[Search] Render fallback failed:', fallbackErr.message);
  }

  throw new Error('All search backends failed');
}

export async function searchSongs(
  query: string,
  mode: SearchMode = 'fast'
): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { songs: [], source: 'youtube', slow: false };

  const cacheKey = `${mode}:${q.toLowerCase()}`;
  
  // Check cache first
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_MS) {
    return cached.data;
  }

  // Check if there's already an active request for this query
  const existingRequest = activeRequests.get(cacheKey);
  if (existingRequest) {
    console.log('[Search] Reusing existing request for:', q);
    return existingRequest;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), mode === 'slow' ? 30000 : 15000);

  const searchPromise = (async (): Promise<SearchResult> => {
    try {
      // FAST = direct YouTube API
      if (mode === 'fast') {
        const songs = (await searchYouTube(q, 10)) as Song[];
        const result: SearchResult = { songs: songs.slice(0, 10), source: 'youtube', slow: false };
        searchCache.set(cacheKey, { data: result, ts: Date.now() });
        return result;
      }

      // SLOW = yt-dlp backend with fallback (concurrency-limited)
      const gotSlot = await acquireSlowSlot(20000);
      if (!gotSlot) {
        return {
          songs: [],
          source: 'ytdlp',
          slow: true,
          error: 'Search is busy right now. Please try again in a moment.',
        };
      }

      try {
        const result = await fetchFromYtdlp(q, controller.signal);
        searchCache.set(cacheKey, { data: result, ts: Date.now() });
        return result;
      } finally {
        releaseSlowSlot();
      }
    } catch (err: any) {
      console.error('[Search] Error:', err.message);
      return {
        songs: [],
        source: mode === 'slow' ? 'ytdlp' : 'youtube',
        slow: false,
        error: err.message || 'Search failed',
      };
    } finally {
      clearTimeout(timeout);
      activeRequests.delete(cacheKey);
    }
  })();

  // Store the promise to prevent duplicate requests
  activeRequests.set(cacheKey, searchPromise);
  
  return searchPromise;
}

export function clearSearchCache() {
  searchCache.clear();
}

// Pre-warm render backend on module load (non-blocking)
wakeupRenderBackend();
