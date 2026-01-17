// Next-song recommendation service
// Calls the recommendation backend directly with raw title/artist - no cleaning, no caching

const RECOMMENDATION_API = 'https://35.209.154.134.sslip.io/recommend';

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}

export interface RecommendationResult {
  songs: Song[];
  slow: boolean;
  source?: string;
  error?: string;
}

async function fetchJsonWithTimeout(url: string, body: any, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function mapToSongs(data: any): Song[] {
  let rawSongs: any[] = [];

  if (Array.isArray(data)) rawSongs = data;
  else if (data?.songs && Array.isArray(data.songs)) rawSongs = data.songs;
  else if (data?.recommendations && Array.isArray(data.recommendations)) rawSongs = data.recommendations;

  return rawSongs
    .slice(0, 5)
    .map((song: any) => ({
      id: song.id || song.videoId || '',
      title: song.title || 'Unknown',
      artist: song.artist || song.channel || 'Unknown',
      thumbnail:
        song.thumbnail ||
        song.thumbnails?.[0]?.url ||
        `https://img.youtube.com/vi/${song.id || song.videoId}/hqdefault.jpg`,
      duration: song.duration || song.lengthSeconds,
    }))
    .filter((s: Song) => Boolean(s.id));
}

// Active fetch deduplication only (no caching)
const active = new Map<string, Promise<RecommendationResult>>();

export async function fetchRecommendations(
  rawTitle: string,
  rawArtist: string
): Promise<RecommendationResult> {
  const startTime = Date.now();

  // Send raw title and artist directly - backend handles cleaning
  const title = rawTitle.trim();
  const artist = rawArtist.trim();
  const key = `${title}::${artist}`;

  if (!title || title === 'Unknown') {
    return { songs: [], slow: false, error: 'Invalid title' };
  }

  // Deduplicate concurrent requests for same song (but no caching)
  const inflight = active.get(key);
  if (inflight) return inflight;

  const promise = (async (): Promise<RecommendationResult> => {
    try {
      console.log('🎵 [Recommendations] Fetching for (raw):', { title, artist });

      const res = await fetchJsonWithTimeout(RECOMMENDATION_API, { title, artist }, 45000);

      const elapsed = Date.now() - startTime;

      if (!res) {
        return { songs: [], slow: true, error: 'Network error' };
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('❌ [Recommendations] Backend error:', res.status, errText);
        return { songs: [], slow: elapsed > 5000, error: `Backend error: ${res.status}` };
      }

      const data = await res.json();
      const songs = mapToSongs(data);
      const source = data.source || 'unknown';

      console.log(`✅ [Recommendations] Got ${songs.length} songs from source: ${source}`);

      if (songs.length === 0) {
        return { songs: [], slow: elapsed > 5000, source, error: 'No recommendations found' };
      }

      return { songs, slow: elapsed > 5000, source };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return { songs: [], slow: true, error: 'Request timed out' };
      }
      return { songs: [], slow: false, error: error?.message || 'Recommendation failed' };
    } finally {
      active.delete(key);
    }
  })();

  active.set(key, promise);
  return promise;
}
