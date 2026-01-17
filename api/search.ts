// Vercel Serverless Function - YouTube Search Proxy
// Primary: YouTube Data API | Fallback: yt-dlp backend

export const config = {
  runtime: 'nodejs',
};

const YTDLP_BACKEND_PRIMARY = 'https://35.209.154.134.sslip.io/search';
const YTDLP_BACKEND_FALLBACK = 'https://ytdlpearch.onrender.com/search';

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
}

interface SearchResponse {
  source: 'youtube' | 'ytdlp';
  count: number;
  results: Song[];
  slow?: boolean;
}

function parseDuration(duration: string): number {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1]) || 0;
  const minutes = parseInt(match[2]) || 0;
  const seconds = parseInt(match[3]) || 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function isLikelyShort(title: string): boolean {
  const shortPatterns = [
    /#shorts?/i,
    /\bshort\b/i,
    /\breels?\b/i,
    /\btiktok\b/i,
    /\bviral\b/i,
    /\b(15|30|60)\s*sec/i,
  ];
  return shortPatterns.some(pattern => pattern.test(title));
}

async function searchWithYouTubeAPI(query: string, apiKey: string, maxResults: number): Promise<Song[]> {
  const fetchCount = Math.min(maxResults * 3, 50);
  
  const searchResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query + ' official audio')}&type=video&videoCategoryId=10&maxResults=${fetchCount}&key=${apiKey}`
  );

  if (!searchResponse.ok) {
    const errorData = await searchResponse.json().catch(() => ({}));
    if (searchResponse.status === 403 && errorData?.error?.errors?.[0]?.reason === 'quotaExceeded') {
      throw new Error('QUOTA_EXCEEDED');
    }
    throw new Error(`YouTube API error: ${searchResponse.status}`);
  }

  const searchData = await searchResponse.json();
  const videoIds = searchData.items.map((item: any) => item.id.videoId).join(',');

  if (!videoIds) return [];

  const detailsResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoIds}&key=${apiKey}`
  );

  if (!detailsResponse.ok) {
    throw new Error('Failed to fetch video details');
  }

  const detailsData = await detailsResponse.json();

  return detailsData.items
    .filter((video: any) => {
      const duration = parseDuration(video.contentDetails.duration);
      const title = video.snippet.title || '';
      if (duration < 120 || duration > 600) return false;
      if (isLikelyShort(title)) return false;
      return true;
    })
    .map((video: any) => ({
      id: video.id,
      title: video.snippet.title,
      artist: video.snippet.channelTitle,
      thumbnail: video.snippet.thumbnails.high?.url || 
                 video.snippet.thumbnails.medium?.url || 
                 video.snippet.thumbnails.default?.url || 
                 `https://img.youtube.com/vi/${video.id}/hqdefault.jpg`,
      duration: parseDuration(video.contentDetails.duration),
    }))
    .slice(0, maxResults);
}

async function searchWithYtdlp(query: string): Promise<{ songs: Song[]; slow: boolean }> {
  const fetchOnce = async (url: string): Promise<{ songs: Song[]; slow: boolean }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s hard limit
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      const elapsed = Date.now() - startTime;
      const slow = elapsed > 5000;

      if (!response.ok) {
        throw new Error(`yt-dlp backend failed: ${response.status}`);
      }

      const data = await response.json();

      const songs: Song[] = (data.results || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        artist: item.artist || 'Unknown',
        thumbnail:
          item.thumbnail ||
          `https://img.youtube.com/vi/${item.id}/hqdefault.jpg`,
        duration: item.duration || 0,
      }));

      return { songs, slow };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('yt-dlp backend timeout');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    return await fetchOnce(YTDLP_BACKEND_PRIMARY);
  } catch (primaryErr) {
    // Fallback to HTTPS endpoint (prevents mixed-content blocks on web)
    return await fetchOnce(YTDLP_BACKEND_FALLBACK);
  }
}


export default async function handler(request: Request) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { headers, status: 405 });
  }

  try {
    const body = await request.json();
    const query = body.query?.trim();
    const apiKey = body.apiKey; // currently passed from frontend
    const mode = body.mode === 'slow' ? 'slow' : 'fast';

    if (!query) {
      return new Response(JSON.stringify({ source: 'youtube', count: 0, results: [] }), { headers });
    }

    // Slow mode: yt-dlp ONLY
    if (mode === 'slow') {
      const { songs, slow } = await searchWithYtdlp(query);
      const response: SearchResponse = {
        source: 'ytdlp',
        count: songs.length,
        results: songs.slice(0, 10),
        slow,
      };
      return new Response(JSON.stringify(response), { headers });
    }

    // Fast mode: YouTube first (if we have a key), then yt-dlp fallback
    if (apiKey) {
      try {
        const songs = await searchWithYouTubeAPI(query, apiKey, 10);

        if (songs.length > 0) {
          const response: SearchResponse = {
            source: 'youtube',
            count: songs.length,
            results: songs,
          };
          return new Response(JSON.stringify(response), { headers });
        }
      } catch (error: any) {
        console.warn('YouTube API failed:', error?.message);
      }


    }

    // Fallback to yt-dlp
    const { songs, slow } = await searchWithYtdlp(query);

    const response: SearchResponse = {
      source: 'ytdlp',
      count: songs.length,
      results: songs.slice(0, 10),
      slow,
    };

    return new Response(JSON.stringify(response), { headers });
  } catch (error) {
    console.error('Search error:', error);
    return new Response(
      JSON.stringify({ source: 'ytdlp', count: 0, results: [], error: 'Search failed' }),
      { headers, status: 500 }
    );
  }
}
