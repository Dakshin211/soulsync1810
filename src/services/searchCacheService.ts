// Firebase-backed search cache with 1-day TTL
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, deleteDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration?: number;
}

interface CachedSearchResult {
  songs: Song[];
  source: 'youtube' | 'ytdlp';
  timestamp: number;
  query: string;
  mode: 'fast' | 'slow';
}

// 1 day cache TTL
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Local memory cache for faster access (session-based)
const memoryCache = new Map<string, { data: CachedSearchResult; ts: number }>();
const MEMORY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for memory cache

// Generate a safe document ID from query
function getDocId(query: string, mode: 'fast' | 'slow'): string {
  // Create a URL-safe base64-like ID
  const normalized = query.toLowerCase().trim();
  const encoded = btoa(encodeURIComponent(normalized)).replace(/[+/=]/g, (c) => 
    c === '+' ? '-' : c === '/' ? '_' : ''
  );
  return `${mode}_${encoded.slice(0, 100)}`;
}

// Check memory cache first
export function getFromMemoryCache(query: string, mode: 'fast' | 'slow'): CachedSearchResult | null {
  const key = `${mode}:${query.toLowerCase().trim()}`;
  const cached = memoryCache.get(key);
  
  if (cached && Date.now() - cached.ts < MEMORY_CACHE_TTL) {
    console.log('[SearchCache] Memory cache hit for:', query);
    return cached.data;
  }
  
  return null;
}

// Set memory cache
function setMemoryCache(query: string, mode: 'fast' | 'slow', data: CachedSearchResult): void {
  const key = `${mode}:${query.toLowerCase().trim()}`;
  memoryCache.set(key, { data, ts: Date.now() });
}

// Get cached search results from Firebase
export async function getCachedSearch(
  userId: string,
  query: string,
  mode: 'fast' | 'slow'
): Promise<CachedSearchResult | null> {
  // Check memory cache first
  const memoryCached = getFromMemoryCache(query, mode);
  if (memoryCached) {
    return memoryCached;
  }
  
  try {
    const docId = getDocId(query, mode);
    const cacheRef = doc(db, 'Users', userId, 'searchCache', docId);
    const docSnap = await getDoc(cacheRef);
    
    if (!docSnap.exists()) {
      console.log('[SearchCache] No cache found for:', query);
      return null;
    }
    
    const data = docSnap.data() as CachedSearchResult;
    
    // Check if cache is expired
    if (Date.now() - data.timestamp > CACHE_TTL_MS) {
      console.log('[SearchCache] Cache expired for:', query);
      // Delete expired cache in background
      deleteDoc(cacheRef).catch(() => {});
      return null;
    }
    
    console.log('[SearchCache] Firebase cache hit for:', query);
    
    // Update memory cache
    setMemoryCache(query, mode, data);
    
    return data;
  } catch (error) {
    console.error('[SearchCache] Error getting cache:', error);
    return null;
  }
}

// Save search results to Firebase cache
export async function setCachedSearch(
  userId: string,
  query: string,
  mode: 'fast' | 'slow',
  songs: Song[],
  source: 'youtube' | 'ytdlp'
): Promise<void> {
  if (!songs.length) return; // Don't cache empty results
  
  const cacheData: CachedSearchResult = {
    songs,
    source,
    timestamp: Date.now(),
    query: query.toLowerCase().trim(),
    mode
  };
  
  // Update memory cache immediately
  setMemoryCache(query, mode, cacheData);
  
  try {
    const docId = getDocId(query, mode);
    const cacheRef = doc(db, 'Users', userId, 'searchCache', docId);
    
    await setDoc(cacheRef, cacheData);
    console.log('[SearchCache] Saved to Firebase:', query);
  } catch (error) {
    console.error('[SearchCache] Error saving cache:', error);
  }
}

// Save search to recent searches with results
export async function saveSearchWithResults(
  userId: string,
  query: string,
  mode: 'fast' | 'slow',
  songs: Song[],
  source: 'youtube' | 'ytdlp'
): Promise<void> {
  if (!query.trim()) return;
  
  // Save to cache
  await setCachedSearch(userId, query, mode, songs, source);
}

// Get recent search with cached results
export async function getRecentSearchWithResults(
  userId: string,
  query: string,
  mode: 'fast' | 'slow'
): Promise<Song[] | null> {
  const cached = await getCachedSearch(userId, query, mode);
  
  if (cached && cached.songs.length > 0) {
    return cached.songs;
  }
  
  return null;
}

// Clean up old cache entries (call periodically)
export async function cleanupExpiredCache(userId: string): Promise<void> {
  try {
    const cacheRef = collection(db, 'Users', userId, 'searchCache');
    const snapshot = await getDocs(cacheRef);
    
    const now = Date.now();
    const deletePromises: Promise<void>[] = [];
    
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data() as CachedSearchResult;
      if (now - data.timestamp > CACHE_TTL_MS) {
        deletePromises.push(deleteDoc(docSnap.ref));
      }
    });
    
    if (deletePromises.length > 0) {
      await Promise.all(deletePromises);
      console.log(`[SearchCache] Cleaned up ${deletePromises.length} expired entries`);
    }
  } catch (error) {
    console.error('[SearchCache] Error cleaning up cache:', error);
  }
}

// Clear all memory cache
export function clearMemoryCache(): void {
  memoryCache.clear();
}
