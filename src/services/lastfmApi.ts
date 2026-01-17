// Last.fm API for music recommendations
const LASTFM_API_KEY = '7421c24f0ec3913d4b931779b627845a';
const LASTFM_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
const REQUEST_TIMEOUT = 10000; // 10 seconds

interface LastFmTrack {
  name: string;
  artist: {
    name: string;
  };
  match?: string;
}

interface Recommendation {
  title: string;
  artist: string;
  score?: number;
}

async function fetchWithTimeout(url: string, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function getSimilarTracks(artist: string, track: string): Promise<Recommendation[]> {
  try {
    console.log('Trying Last.fm similar tracks...');
    const url = `${LASTFM_BASE_URL}?method=track.getsimilar&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&api_key=${LASTFM_API_KEY}&format=json&limit=20`;
    
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT);
    
    if (!response.ok) {
      throw new Error(`Last.fm API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.similartracks?.track) {
      console.warn('No similar tracks found');
      return [];
    }
    
    const tracks = Array.isArray(data.similartracks.track) 
      ? data.similartracks.track 
      : [data.similartracks.track];
    
    return tracks
      .filter((t: LastFmTrack) => t.name && t.artist?.name)
      .map((t: LastFmTrack) => ({
        title: t.name,
        artist: t.artist.name,
        score: parseFloat(t.match || '0'),
      }));
  } catch (error) {
    console.warn('Last.fm similar tracks failed:', error);
    return [];
  }
}

export async function getArtistTopTracks(artist: string): Promise<Recommendation[]> {
  try {
    console.log('Trying Last.fm artist top tracks...');
    const url = `${LASTFM_BASE_URL}?method=artist.gettoptracks&artist=${encodeURIComponent(artist)}&api_key=${LASTFM_API_KEY}&format=json&limit=10`;
    
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT);
    
    if (!response.ok) {
      throw new Error(`Last.fm API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.toptracks?.track) {
      console.warn('No top tracks found');
      return [];
    }
    
    const tracks = Array.isArray(data.toptracks.track) 
      ? data.toptracks.track 
      : [data.toptracks.track];
    
    return tracks
      .filter((t: any) => t.name && t.artist?.name)
      .map((t: any) => ({
        title: t.name,
        artist: t.artist.name,
      }));
  } catch (error) {
    console.warn('Last.fm artist top tracks failed:', error);
    return [];
  }
}

// Search artists via Last.fm
export interface LastFmArtist {
  name: string;
  image: string;
  listeners?: number;
}

export async function searchArtists(query: string, limit: number = 10): Promise<LastFmArtist[]> {
  try {
    const url = `${LASTFM_BASE_URL}?method=artist.search&artist=${encodeURIComponent(query)}&api_key=${LASTFM_API_KEY}&format=json&limit=${limit}`;
    
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT);
    
    if (!response.ok) {
      throw new Error(`Last.fm API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.results?.artistmatches?.artist) {
      return [];
    }
    
    const artists = Array.isArray(data.results.artistmatches.artist) 
      ? data.results.artistmatches.artist 
      : [data.results.artistmatches.artist];
    
    return artists
      .filter((a: any) => a.name)
      .map((a: any) => {
        // Get the largest image available
        const images = a.image || [];
        const largeImage = images.find((img: any) => img.size === 'large' || img.size === 'extralarge');
        const mediumImage = images.find((img: any) => img.size === 'medium');
        const imageUrl = largeImage?.['#text'] || mediumImage?.['#text'] || '';
        
        return {
          name: a.name,
          image: imageUrl,
          listeners: parseInt(a.listeners || '0', 10),
        };
      });
  } catch (error) {
    console.warn('Last.fm artist search failed:', error);
    return [];
  }
}

// Get artist info with image
export async function getArtistInfo(artist: string): Promise<{ name: string; image: string } | null> {
  try {
    const url = `${LASTFM_BASE_URL}?method=artist.getinfo&artist=${encodeURIComponent(artist)}&api_key=${LASTFM_API_KEY}&format=json`;
    
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    if (!data.artist) {
      return null;
    }
    
    const images = data.artist.image || [];
    const largeImage = images.find((img: any) => img.size === 'extralarge' || img.size === 'large');
    const mediumImage = images.find((img: any) => img.size === 'medium');
    
    return {
      name: data.artist.name,
      image: largeImage?.['#text'] || mediumImage?.['#text'] || '',
    };
  } catch (error) {
    console.warn('Last.fm artist info failed:', error);
    return null;
  }
}
