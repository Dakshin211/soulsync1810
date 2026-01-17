// Vercel Serverless Function - Recommendation Proxy
// Proxies requests to the recommendation backend to avoid CORS/mixed-content issues

export const config = {
  runtime: 'nodejs',
};

const RECOMMENDATION_BACKEND = 'https://35.209.154.134.sslip.io/recommend';

interface RecommendationRequest {
  title: string;
  artist: string;
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
    const body: RecommendationRequest = await request.json();
    const { title, artist } = body;

    if (!title) {
      return new Response(
        JSON.stringify({ songs: [], error: 'Title is required' }),
        { headers, status: 400 }
      );
    }

    console.log(`[Recommend API] Fetching for: "${title}" by "${artist || 'Unknown'}"`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const response = await fetch(RECOMMENDATION_BACKEND, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, artist: artist || '' }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[Recommend API] Backend error: ${response.status}`, errorText);
      return new Response(
        JSON.stringify({ songs: [], error: `Backend error: ${response.status}` }),
        { headers, status: 502 }
      );
    }

    const data = await response.json();
    console.log(`[Recommend API] Got response:`, JSON.stringify(data).slice(0, 200));

    // Pass through the response
    return new Response(JSON.stringify(data), { headers });
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('[Recommend API] Request timed out');
      return new Response(
        JSON.stringify({ songs: [], error: 'Request timed out' }),
        { headers, status: 504 }
      );
    }

    console.error('[Recommend API] Error:', error);
    return new Response(
      JSON.stringify({ songs: [], error: error.message || 'Internal error' }),
      { headers, status: 500 }
    );
  }
}
