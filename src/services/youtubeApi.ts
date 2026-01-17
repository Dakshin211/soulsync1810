// YouTube API service with Firebase config, key rotation, aggressive caching, and quota detection

import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

const FALLBACK_THUMBNAIL = 'https://via.placeholder.com/480x360/9333EA/FFFFFF?text=No+Thumbnail';

let YOUTUBE_API_KEYS: string[] = [];
let keysLoaded = false;

// Track daily usage for fallback key decision
const DAILY_USAGE_KEY = 'yt_daily_usage';
const INTERNAL_USAGE_KEY = 'yt_internal_usage'; // For fav artist/recommendation calls only
const USAGE_THRESHOLD = 35; // Switch to backup key after ~35 internal calls (fav artist, recommendations)
const SEARCH_FALLBACK_THRESHOLD = 80; // For general search, higher threshold

function getDailyUsage(key: string = DAILY_USAGE_KEY): number {
  try {
    const data = localStorage.getItem(key);
    if (!data) return 0;
    const parsed = JSON.parse(data);
    const today = new Date().toISOString().split('T')[0];
    return parsed.date === today ? parsed.count : 0;
  } catch {
    return 0;
  }
}

function incrementDailyUsage(key: string = DAILY_USAGE_KEY): void {
  try {
    const today = new Date().toISOString().split('T')[0];
    const current = getDailyUsage(key);
    localStorage.setItem(key, JSON.stringify({ date: today, count: current + 1 }));
  } catch {}
}

// Check if YT API is exhausted for fast search
export function isYouTubeApiExhausted(): boolean {
  const internalUsage = getDailyUsage(INTERNAL_USAGE_KEY);
  const searchUsage = getDailyUsage(DAILY_USAGE_KEY);
  return internalUsage >= USAGE_THRESHOLD && searchUsage >= SEARCH_FALLBACK_THRESHOLD;
}

// Load YouTube API keys from Firebase config (primary + backup)
async function loadApiKeys(): Promise<void> {
  if (keysLoaded) return;
  
  try {
    const configRef = doc(db, 'config', 'youtube');
    const configSnap = await getDoc(configRef);
    
    if (configSnap.exists()) {
      const data = configSnap.data();
      const keys: string[] = [];
      
      // Primary key
      if (data.apiKey) keys.push(data.apiKey);
      
      // Backup key (used when quota is high or primary fails)
      if (data.apiKeyBackup) keys.push(data.apiKeyBackup);
      
      if (keys.length > 0) {
        YOUTUBE_API_KEYS = keys;
        keysLoaded = true;
        console.log(`✅ [YouTube] ${keys.length} API key(s) loaded from Firebase`);
      }
    }
    
    if (YOUTUBE_API_KEYS.length === 0) {
      console.warn('⚠️ [YouTube] No API key found in Firebase config/youtube');
    }
  } catch (error) {
    console.error('❌ [YouTube] Failed to load API key from Firebase:', error);
  }
}

let currentKeyIndex = 0;
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours for aggressive caching
const QUOTA_EXCEEDED_KEY = 'yt_quota_exceeded';
const QUOTA_RESET_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Load cache from localStorage on init
try {
  const savedCache = localStorage.getItem('youtube_cache');
  if (savedCache) {
    const parsed = JSON.parse(savedCache);
    Object.entries(parsed).forEach(([key, value]: [string, any]) => {
      if (Date.now() - value.timestamp < CACHE_DURATION) {
        cache.set(key, value);
      }
    });
  }
} catch (e) {
  console.error('Error loading YouTube cache:', e);
}

export function isYouTubeQuotaExceeded(): boolean {
  try {
    const exceededTimestamp = localStorage.getItem(QUOTA_EXCEEDED_KEY);
    if (!exceededTimestamp) return false;
    
    const timestamp = parseInt(exceededTimestamp, 10);
    if (Date.now() - timestamp < QUOTA_RESET_DURATION) {
      return true;
    }
    
    localStorage.removeItem(QUOTA_EXCEEDED_KEY);
    return false;
  } catch (e) {
    return false;
  }
}

async function markQuotaExceeded(): Promise<void> {
  try {
    localStorage.setItem(QUOTA_EXCEEDED_KEY, Date.now().toString());
    console.warn('⚠️ [YouTube] Quota exceeded - will not use YouTube for 24 hours');
    
    const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
    const quotaRef = doc(db, 'Admin', 'Quota');
    await setDoc(quotaRef, {
      yt_blocked_until: serverTimestamp(),
      blockedAt: new Date().toISOString(),
      reason: 'quotaExceeded'
    }, { merge: true });
  } catch (e) {
    console.error('Failed to mark quota exceeded:', e);
  }
}

function getNextApiKey(isInternalCall: boolean = false): string | null {
  if (YOUTUBE_API_KEYS.length === 0) return null;
  
  // For internal calls (fav artist, recommendations), use lower threshold
  const threshold = isInternalCall ? USAGE_THRESHOLD : SEARCH_FALLBACK_THRESHOLD;
  const usageKey = isInternalCall ? INTERNAL_USAGE_KEY : DAILY_USAGE_KEY;
  const usage = getDailyUsage(usageKey);
  
  if (YOUTUBE_API_KEYS.length > 1 && usage >= threshold) {
    console.log(`📊 [YouTube] High ${isInternalCall ? 'internal' : 'search'} usage (${usage}), using backup key`);
    return YOUTUBE_API_KEYS[1]; // Backup key
  }
  
  const key = YOUTUBE_API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % YOUTUBE_API_KEYS.length;
  return key;
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
  
  try {
    const cacheObj: any = {};
    cache.forEach((value, key) => {
      cacheObj[key] = value;
    });
    localStorage.setItem('youtube_cache', JSON.stringify(cacheObj));
  } catch (e) {
    console.error('Error saving YouTube cache:', e);
  }
}

// Helper to check if a video is likely a short (based on title patterns)
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

export async function searchYouTube(query: string, maxResults: number = 10, isInternalCall: boolean = false) {
  await loadApiKeys();
  
  // Track usage for quota management (separate counters for internal vs search)
  incrementDailyUsage(isInternalCall ? INTERNAL_USAGE_KEY : DAILY_USAGE_KEY);
  
  if (isYouTubeQuotaExceeded()) {
    console.warn('⚠️ [YouTube] Quota exceeded, returning empty results');
    return [];
  }

  if (YOUTUBE_API_KEYS.length === 0) {
    console.warn('⚠️ [YouTube] No API keys available');
    return [];
  }
  
  const cacheKey = `search:${query}:${maxResults}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  for (let attempt = 0; attempt < YOUTUBE_API_KEYS.length; attempt++) {
    try {
      const apiKey = getNextApiKey(isInternalCall);
      if (!apiKey) return [];
      
      // Request more results to filter properly
      const fetchCount = Math.min(maxResults * 3, 50);
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query + ' official audio')}&type=video&videoCategoryId=10&maxResults=${fetchCount}&key=${apiKey}`
      );

      if (!response.ok) {
        if (response.status === 403) {
          const errorData = await response.json().catch(() => ({}));
          if (errorData?.error?.errors?.[0]?.reason === 'quotaExceeded') {
            await markQuotaExceeded();
            return [];
          }
          continue;
        }
        throw new Error(`YouTube API error: ${response.status}`);
      }

      const data = await response.json();
      
      const videoIds = data.items.map((item: any) => item.id.videoId).join(',');
      const detailsResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${videoIds}&key=${apiKey}`
      );
      
      const detailsData = await detailsResponse.json();
      
      // Filter songs: 2-10 minutes (120-600 seconds) to exclude shorts and very long videos
      const songs = detailsData.items
        .filter((video: any) => {
          const duration = parseDuration(video.contentDetails.duration);
          const title = video.snippet.title || '';
          
          // Strict duration filter: 2-10 minutes (real songs only)
          if (duration < 120 || duration > 600) return false;
          
          // Filter out shorts by title patterns
          if (isLikelyShort(title)) return false;
          
          return true;
        })
        .map((video: any) => {
          const thumbnail = video.snippet.thumbnails.high?.url || 
                           video.snippet.thumbnails.medium?.url || 
                           video.snippet.thumbnails.default?.url || 
                           FALLBACK_THUMBNAIL;
          
          return {
            id: video.id,
            title: video.snippet.title,
            artist: video.snippet.channelTitle,
            thumbnail,
            duration: parseDuration(video.contentDetails.duration),
          };
        })
        .slice(0, maxResults);

      setCachedData(cacheKey, songs);
      return songs;
    } catch (error) {
      console.error(`Error with API key ${attempt + 1}:`, error);
    }
  }

  return [];
}

export async function getTrendingSongs(maxResults: number = 20) {
  await loadApiKeys();
  
  if (isYouTubeQuotaExceeded()) {
    console.warn('⚠️ [YouTube] Quota exceeded for trending');
    return [];
  }
  
  if (YOUTUBE_API_KEYS.length === 0) {
    console.warn('⚠️ [YouTube] No API keys available');
    return [];
  }
  
  const cacheKey = `trending:${maxResults}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  for (let attempt = 0; attempt < YOUTUBE_API_KEYS.length; attempt++) {
    try {
      const apiKey = getNextApiKey();
      if (!apiKey) return [];
      
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&chart=mostPopular&videoCategoryId=10&maxResults=${maxResults * 2}&regionCode=US&key=${apiKey}`
      );

      if (!response.ok) {
        if (response.status === 403) {
          const errorData = await response.json().catch(() => ({}));
          if (errorData?.error?.errors?.[0]?.reason === 'quotaExceeded') {
            await markQuotaExceeded();
            return [];
          }
          continue;
        }
        throw new Error(`YouTube API error: ${response.status}`);
      }

      const data = await response.json();
      
      const songs = data.items
        .filter((video: any) => {
          const duration = parseDuration(video.contentDetails.duration);
          const title = video.snippet.title || '';
          
          // 2-10 minutes filter
          if (duration < 120 || duration > 600) return false;
          if (isLikelyShort(title)) return false;
          
          return true;
        })
        .map((video: any) => {
          const thumbnail = video.snippet.thumbnails.high?.url || 
                           video.snippet.thumbnails.medium?.url || 
                           video.snippet.thumbnails.default?.url || 
                           FALLBACK_THUMBNAIL;
          
          return {
            id: video.id,
            title: video.snippet.title,
            artist: video.snippet.channelTitle,
            thumbnail,
            duration: parseDuration(video.contentDetails.duration),
          };
        })
        .slice(0, maxResults);

      setCachedData(cacheKey, songs);
      return songs;
    } catch (error) {
      console.error(`Error with API key ${attempt + 1}:`, error);
    }
  }

  return [];
}

export async function getArtistSongs(artistName: string, maxResults: number = 10) {
  if (isYouTubeQuotaExceeded()) {
    console.warn('⚠️ [YouTube] Quota exceeded for artist songs');
    return [];
  }
  
  const cacheKey = `artist:${artistName}:${maxResults}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  // Mark as internal call (fav artist) to use lower threshold
  const songs = await searchYouTube(`${artistName} official audio`, maxResults, true);
  setCachedData(cacheKey, songs);
  return songs;
}

export async function searchArtists(query: string) {
  await loadApiKeys();
  
  // Artist search for fav artists - use internal counter
  incrementDailyUsage(INTERNAL_USAGE_KEY);
  
  if (isYouTubeQuotaExceeded()) {
    console.warn('⚠️ [YouTube] Quota exceeded for artist search');
    return [];
  }
  
  if (YOUTUBE_API_KEYS.length === 0) {
    console.warn('⚠️ [YouTube] No API keys available');
    return [];
  }
  
  const cacheKey = `artists:${query}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  for (let attempt = 0; attempt < YOUTUBE_API_KEYS.length; attempt++) {
    try {
      const apiKey = getNextApiKey(true); // Internal call
      if (!apiKey) return [];
      
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=channel&maxResults=10&key=${apiKey}`
      );

      if (!response.ok) {
        if (response.status === 403) {
          const errorData = await response.json().catch(() => ({}));
          if (errorData?.error?.errors?.[0]?.reason === 'quotaExceeded') {
            await markQuotaExceeded();
            return [];
          }
          continue;
        }
        throw new Error(`YouTube API error: ${response.status}`);
      }

      const data = await response.json();
      const artists = data.items.map((item: any) => {
        const image = item.snippet.thumbnails.high?.url || 
                     item.snippet.thumbnails.medium?.url || 
                     item.snippet.thumbnails.default?.url || 
                     FALLBACK_THUMBNAIL;
        
        return {
          id: item.id.channelId,
          name: item.snippet.title,
          image,
        };
      });

      setCachedData(cacheKey, artists);
      return artists;
    } catch (error) {
      console.error(`Error with API key ${attempt + 1}:`, error);
    }
  }

  return [];
}

function parseDuration(duration: string): number {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return 0;

  const hours = parseInt(match[1]) || 0;
  const minutes = parseInt(match[2]) || 0;
  const seconds = parseInt(match[3]) || 0;

  return hours * 3600 + minutes * 60 + seconds;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
