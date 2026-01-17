// Gemini API with Groq fallback for daily home content (Firestore-based)
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const REQUEST_TIMEOUT = 20000; // 20 seconds per API

interface Song {
  rank?: number;
  title: string;
  artist: string;
}

interface Artist {
  rank?: number;
  name: string;
  genre?: string;
}

// 🔹 Fetch Gemini and Groq keys from Firestore
async function getApiKeys(collection: 'gemini' | 'groq'): Promise<string[]> {
  try {
    const ref = doc(db, 'config', collection);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error(`${collection} config not found`);
    const data = snap.data();
    const keys: string[] = data?.apikeys || [];
    if (keys.length === 0) throw new Error(`No ${collection} API keys found`);
    return keys;
  } catch (err) {
    console.error(`Error loading ${collection} API keys:`, err);
    return [];
  }
}

// 🔹 Pick next key in sequence
let geminiKeyIndex = 0;
function getNextGeminiKey(keys: string[]): string {
  const key = keys[geminiKeyIndex];
  geminiKeyIndex = (geminiKeyIndex + 1) % keys.length;
  return key;
}

// 🔹 Call Gemini API
async function callGeminiAPI(prompt: string): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const keys = await getApiKeys('gemini');
    if (keys.length === 0) throw new Error('No Gemini keys found');

    for (const key of keys) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
            }),
          }
        );

        if (response.ok) {
          clearTimeout(timeoutId);
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          const jsonMatch = text?.match(/\[[\s\S]*?\]/);
          if (jsonMatch) return JSON.parse(jsonMatch[0]);
        } else {
          console.warn(`Gemini key failed (${key.slice(0, 8)}...)`);
        }
      } catch (err) {
        console.warn(`Gemini key error (${key.slice(0, 8)}...):`, err);
      }
    }

    throw new Error('All Gemini keys failed');
  } finally {
    clearTimeout(timeoutId);
  }
}

// 🔹 Call Groq API (multiple key fallback)
async function callGroqAPI(prompt: string): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const keys = await getApiKeys('groq');
    if (keys.length === 0) throw new Error('No Groq keys found');

    for (const key of keys) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              {
                role: 'system',
                content: 'You are a music expert. Return only valid JSON array. No explanations.',
              },
              { role: 'user', content: prompt },
            ],
            temperature: 0.7,
            max_tokens: 1024,
          }),
        });

        if (response.ok) {
          clearTimeout(timeoutId);
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content;
          const jsonMatch = content?.match(/\[[\s\S]*?\]/);
          if (jsonMatch) return JSON.parse(jsonMatch[0]);
        } else {
          console.warn(`Groq key failed (${key.slice(0, 8)}...)`);
        }
      } catch (err) {
        console.warn(`Groq key error (${key.slice(0, 8)}...):`, err);
      }
    }

    throw new Error('All Groq keys failed');
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============= ROLLBACK: Revert to previous version if issues occur =============
// 🔹 Try Groq first → fallback to Gemini (reduced tokens: temp=0, max_tokens=800)
async function fetchWithFallback(prompt: string): Promise<any> {
  try {
    console.log('Trying Groq...');
    return await callGroqAPI(prompt);
  } catch {
    console.warn('Groq failed → trying Gemini...');
    return await callGeminiAPI(prompt);
  }
}

// 🔹 Batched fetch with Gemini fallback
export async function fetchHomeBatchWithFallback(): Promise<any> {
  const prompt = `Return ONLY valid JSON with this structure (no markdown):

{
  "trending": [{"rank": 1, "title": "Song", "artist": "Artist"}, ...], // 15 trending songs
  "globalHits": [{"rank": 1, "title": "Song", "artist": "Artist"}, ...], // 15 all-time hits
  "regionalHits": [{"rank": 1, "title": "Song", "artist": "Artist"}, ...], // 15 India/TN hits
  "famousArtists": [{"rank": 1, "name": "Artist", "genre": "Genre"}, ...] // 15 famous artists
}

Include only real songs from verified artists. Global hits: Blinding Lights, Shape of You, Perfect, etc.`;

  try {
    console.log('Trying Groq batch...');
    const keys = await getApiKeys('groq');
    
    for (const key of keys) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'You are a music API. Return ONLY valid JSON.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0,
            max_tokens: 2500,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || '';
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        }
      } catch (err) {
        console.warn('Groq batch error:', err);
      }
    }
    
    throw new Error('Groq batch failed');
  } catch {
    console.warn('Groq failed → trying Gemini batch...');
    
    // Gemini fallback
    const keys = await getApiKeys('gemini');
    for (const key of keys) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 2500 },
            }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          const jsonMatch = text?.match(/\{[\s\S]*\}/);
          if (jsonMatch) return JSON.parse(jsonMatch[0]);
        }
      } catch (err) {
        console.warn('Gemini batch error:', err);
      }
    }
    
    throw new Error('All batch fetch attempts failed');
  }
}


// ---------- Main Data Functions ----------

export async function getTrendingSongs(): Promise<Song[]> {
  const prompt = `Provide JSON array of exactly 15 trending songs globally today. Each entry must have: {"rank": number, "title": "Song Name", "artist": "Artist Name"}. Include only real, popular songs from verified artists. Exclude songs under 1 minute, ads, covers, remixes, or non-music content. Focus on current hits. Return ONLY the JSON array, no explanations.`;
  try {
    const result = await fetchWithFallback(prompt);
    return result.filter((s: any) => s.title && s.artist).slice(0, 15);
  } catch (err) {
    console.error('Error fetching trending songs:', err);
    return [];
  }
}

// ============= ROLLBACK: Revert to previous version if issues occur =============
export async function getRecommendedSongs(favoriteArtists: string[]): Promise<Song[]> {
  const artistList = favoriteArtists.slice(0, 5).join(', ');
  const prompt = `Based on favorite artists: ${artistList}, suggest 15 songs. Return ONLY JSON array: [{"rank": 1, "title": "Song", "artist": "Artist"}, ...]. Include similar artists/genres.`;
  try {
    // Reduced tokens: short prompt, temp=0
    const keys = await getApiKeys('groq');
    for (const key of keys) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'Return ONLY JSON array.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0,
            max_tokens: 800,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || '';
          const jsonMatch = content.match(/\[[\s\S]*?\]/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            return result.filter((s: any) => s.title && s.artist).slice(0, 15);
          }
        }
      } catch (err) {
        console.warn('Groq recommendation error:', err);
      }
    }
    
    // Gemini fallback
    const result = await fetchWithFallback(prompt);
    return result.filter((s: any) => s.title && s.artist).slice(0, 15);
  } catch (err) {
    console.error('Error fetching recommended songs:', err);
    return [];
  }
}

export async function getGlobalHits(): Promise<Song[]> {
  const prompt = `Provide JSON array of the top 15 most streamed songs on Spotify of all time. Each entry: {"rank": number, "title": "Song Name", "artist": "Artist Name"}. Include only verified hit songs like "Blinding Lights" by The Weeknd, "Shape of You" by Ed Sheeran ,Sweater weather by the neighbours ,as it was by harry styles ,perfect ed shareen etc. Return ONLY JSON array.`;
  try {
    const result = await fetchWithFallback(prompt);
    return result.filter((s: any) => s.title && s.artist).slice(0, 15);
  } catch (err) {
    console.error('Error fetching global hits:', err);
    return [];
  }
}

export async function getFamousArtists(): Promise<Artist[]> {
  const artistNames = [
    'The Weeknd', 'Bruno Mars', 'Taylor Swift', 'Lana Del Rey', 'Lady Gaga',
    'Justin Bieber', 'Billie Eilish', 'Ed Sheeran', 'Coldplay', 'Ariana Grande',
    'Bad Bunny', 'Alan Walker', 'David Guetta', 'Sabrina Carpenter', 'Arctic Monkeys',
  ];
  return artistNames.map((name, index) => ({
    rank: index + 1,
    name,
    genre: 'Pop',
  }));
}

export async function getRegionalHits(region: string = 'IN'): Promise<Song[]> {
  const prompt = `Provide JSON array of 15 trending songs in ${region} region today. Each entry: {"rank": number, "title": "Song Name", "artist": "Artist Name"}. Include regional chart-toppers and local favorites from 2024-2025. Return ONLY JSON array.`;
  try {
    const result = await fetchWithFallback(prompt);
    return result.filter((s: any) => s.title && s.artist).slice(0, 15);
  } catch (err) {
    console.error('Error fetching regional hits:', err);
    return [];
  }
}
