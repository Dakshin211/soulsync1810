// Smart next song recommendations using Last.fm API

const LASTFM_API_KEY = '7421c24f0ec3913d4b931779b627845a';
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

interface Song {
  title: string;
  artist: string;
}

function getCachedData(cacheKey: string) {
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  return null;
}

function setCachedData(cacheKey: string, data: any) {
  cache.set(cacheKey, { data, timestamp: Date.now() });
}

export async function getSimilarTracks(artist: string, track: string): Promise<Song[]> {
  const cacheKey = `similar:${artist}:${track}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&api_key=${LASTFM_API_KEY}&format=json&limit=20`
    );

    if (!response.ok) {
      throw new Error('Last.fm API error');
    }

    const data = await response.json();
    
    if (!data.similartracks?.track) {
      return [];
    }

    const tracks = data.similartracks.track
      .filter((t: any) => t.name && t.artist?.name)
      .map((t: any) => ({
        title: t.name,
        artist: t.artist.name,
      }));

    setCachedData(cacheKey, tracks);
    return tracks;
  } catch (error) {
    console.error('Error fetching similar tracks:', error);
    return [];
  }
}

export function getRandomRecommendation(recommendations: Song[]): Song | null {
  if (recommendations.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * recommendations.length);
  return recommendations[randomIndex];
}
