// Firebase + Groq API handler
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const GROQ_API_URL = 'https://api.groq.com/openai/v1';

// 🔹 Fetch Groq API keys array from Firestore (config/groq/apikeys)
async function getGroqApiKeys(): Promise<string[]> {
  try {
    const groqDocRef = doc(db, 'config', 'groq');
    const groqSnap = await getDoc(groqDocRef);

    if (!groqSnap.exists()) throw new Error('Groq config not found in Firestore');

    const data = groqSnap.data();
    const keys: string[] = data?.apikeys || [];

    if (keys.length === 0) throw new Error('No Groq API keys found in Firestore');
    return keys;
  } catch (error) {
    console.error('Error fetching Groq API keys:', error);
    throw error;
  }
}

// 🔹 Get available Groq models (auto-switching between keys)
export async function fetchGroqModels() {
  const keys = await getGroqApiKeys();

  for (const key of keys) {
    try {
      const response = await fetch(`${GROQ_API_URL}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
      });

      if (response.ok) {
        const data = await response.json();
        return data;
      } else {
        console.warn(`Groq key failed (${key.slice(0, 10)}...) — trying next`);
      }
    } catch (err) {
      console.error(`Error using Groq key ${key.slice(0, 10)}...`, err);
    }
  }

  throw new Error('All Groq API keys failed.');
}

// 🔹 Chat with Groq (auto-fallback between multiple keys)
export async function askGroq(prompt: string) {
  const keys = await getGroqApiKeys();

  for (const key of keys) {
    try {
      const response = await fetch(`${GROQ_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content || 'No response from Groq';
      } else {
        console.warn(`Groq key failed (${key.slice(0, 10)}...) — switching...`);
      }
    } catch (err) {
      console.warn(`Groq key error (${key.slice(0, 10)}...)`, err);
    }
  }

  throw new Error('All Groq API keys failed.');
}

// ============= ROLLBACK: Revert to previous version if issues occur =============
// 🔹 Batched home data fetch - ONE API call for all sections (saves tokens!)
export async function fetchHomeBatch(): Promise<any> {
  const keys = await getGroqApiKeys();
  
  const prompt = `You are a music data API. Return ONLY a valid JSON object with the following structure (no markdown, no explanations):

{
  "trending": [{"rank": 1, "title": "Song Name", "artist": "Artist Name"}, ...], // 15 current trending songs globally
  "globalHits": [{"rank": 1, "title": "Song Name", "artist": "Artist Name"}, ...], // 15 all-time most-streamed songs (Blinding Lights, Shape of You, etc.)
  "regionalHits": [{"rank": 1, "title": "Song Name", "artist": "Artist Name"}, ...], // 15 trending songs in India/Tamil Nadu region
  "famousArtists": [{"rank": 1, "name": "Artist Name", "genre": "Genre"}, ...] // 15 famous artists globally
}

Requirements:
- All songs must be real, popular tracks from verified artists
- Exclude remixes, covers, ads, or non-music content
- Global hits should include iconic all-time hits (e.g., Blinding Lights, Shape of You, Perfect, As It Was, Sweater Weather)
- Return ONLY the JSON object, nothing else`;

  for (const key of keys) {
    try {
      const response = await fetch(`${GROQ_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are a music data API. Return only valid JSON, no explanations.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0, // Deterministic output
          max_tokens: 2500, // Enough for all sections
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        
        // Extract JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          console.log('✅ [Groq] Batched home data fetched successfully');
          return parsed;
        }
      } else {
        console.warn(`Groq key failed (${key.slice(0, 10)}...) — switching...`);
      }
    } catch (err) {
      console.warn(`Groq batch fetch error (${key.slice(0, 10)}...)`, err);
    }
  }

  throw new Error('All Groq API keys failed for batch fetch');
}
