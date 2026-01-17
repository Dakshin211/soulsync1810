// Unified recommendation service with timeouts and fallback chain
// Last.fm → Groq → Gemini with 10s per-request timeout, 20s overall timeout

import { getSimilarTracks } from './lastfmApi';

const GROQ_API_KEY = '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';
const GEMINI_API_KEYS = [
  'AIzaSyA_ApTLLoVhY23vmcAJavGbAjbviXI6YHk',
  'AIzaSyBDpAtcbZSFJOYctcPIkqoHB1yyYem6WPQ'
];

const REQUEST_TIMEOUT = 10000; // 10 seconds per request
const OVERALL_TIMEOUT = 20000; // 20 seconds total
let currentGeminiKeyIndex = 0;

function getNextGeminiKey(): string {
  const key = GEMINI_API_KEYS[currentGeminiKeyIndex];
  currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % GEMINI_API_KEYS.length;
  return key;
}

export interface Recommendation {
  title: string;
  artist: string;
  source?: 'lastfm' | 'groq' | 'gemini';
  score?: number;
}

// Timeout wrapper for fetch requests
async function fetchWithTimeout(url: string, options: RequestInit, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Last.fm: Get similar tracks (using imported function)
async function getLastFmSimilar(artist: string, track: string): Promise<Recommendation[]> {
  try {
    const results = await getSimilarTracks(artist, track);
    return results.map(r => ({
      ...r,
      source: 'lastfm' as const
    }));
  } catch (error) {
    console.warn('Last.fm failed:', error);
    return [];
  }
}

// Groq: AI-based recommendations
async function getGroqRecommendations(artist: string, track: string): Promise<Recommendation[]> {
  try {
    console.log('Trying Groq for recommendations...');
    const prompt = `Suggest 10 songs similar to "${track}" by "${artist}". Return ONLY a JSON array like: [{"title":"Song Name","artist":"Artist Name"}]. No explanations.`;
    
    const response = await fetchWithTimeout(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are a music expert. Return only valid JSON array. No explanations.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      },
      REQUEST_TIMEOUT
    );
    
    if (!response.ok) {
      throw new Error(`Groq error: ${response.status}`);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Parse JSON from response (handle both raw JSON and text containing JSON)
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      throw new Error('No JSON in Groq response');
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed
      .filter((item: any) => item.title && item.artist)
      .map((item: any) => ({
        title: item.title,
        artist: item.artist,
        source: 'groq' as const,
      }));
  } catch (error) {
    console.warn('Groq failed:', error);
    return [];
  }
}

// Gemini: AI-based recommendations
async function getGeminiRecommendations(artist: string, track: string): Promise<Recommendation[]> {
  try {
    console.log('Trying Gemini for recommendations...');
    const prompt = `Suggest 10 songs similar to "${track}" by "${artist}". Return ONLY a JSON array: [{"title":"Song Name","artist":"Artist Name"}]`;
    
    const apiKey = getNextGeminiKey();
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500,
          }
        }),
      },
      REQUEST_TIMEOUT
    );
    
    if (!response.ok) {
      throw new Error(`Gemini error: ${response.status}`);
    }
    
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      throw new Error('No JSON in Gemini response');
    }
    
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed
      .filter((item: any) => item.title && item.artist)
      .map((item: any) => ({
        title: item.title,
        artist: item.artist,
        source: 'gemini' as const,
      }));
  } catch (error) {
    console.warn('Gemini failed:', error);
    return [];
  }
}

// Main recommendation function with fallback chain and overall timeout
export async function getRecommendations(artist: string, track: string): Promise<Recommendation[]> {
  const overallTimeout = new Promise<Recommendation[]>((resolve) => {
    setTimeout(() => {
      console.warn('Overall recommendation timeout reached');
      resolve([]);
    }, OVERALL_TIMEOUT);
  });
  
  const recommendationPromise = async (): Promise<Recommendation[]> => {
    // Try Last.fm first
    let results = await getLastFmSimilar(artist, track);
    if (results.length > 0) {
      console.log(`Got ${results.length} recommendations from Last.fm`);
      return deduplicateAndLimit(results, 10);
    }
    
    // Fallback to Groq
    results = await getGroqRecommendations(artist, track);
    if (results.length > 0) {
      console.log(`Got ${results.length} recommendations from Groq`);
      return deduplicateAndLimit(results, 10);
    }
    
    // Final fallback to Gemini
    results = await getGeminiRecommendations(artist, track);
    if (results.length > 0) {
      console.log(`Got ${results.length} recommendations from Gemini`);
      return deduplicateAndLimit(results, 10);
    }
    
    console.warn('All recommendation sources failed');
    return [];
  };
  
  return Promise.race([overallTimeout, recommendationPromise()]);
}

// Deduplicate by title+artist and limit results
function deduplicateAndLimit(recommendations: Recommendation[], maxCount: number): Recommendation[] {
  const seen = new Set<string>();
  const unique: Recommendation[] = [];
  
  for (const rec of recommendations) {
    const key = `${rec.title.toLowerCase()}|${rec.artist.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(rec);
      if (unique.length >= maxCount) break;
    }
  }
  
  return unique;
}

// Get recommendations for multiple artists (for user profile)
export async function getRecommendationsForArtists(artists: string[]): Promise<Recommendation[]> {
  const allRecs: Recommendation[] = [];
  
  // Get recommendations for each artist
  for (const artist of artists.slice(0, 3)) {
    try {
      // Use a popular song from the artist to get recommendations
      const recs = await getRecommendations(artist, artist);
      allRecs.push(...recs);
    } catch (error) {
      console.warn(`Failed to get recommendations for ${artist}:`, error);
    }
  }
  
  return deduplicateAndLimit(allRecs, 15);
}
