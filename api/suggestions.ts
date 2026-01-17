// Vercel Serverless Function - YouTube Autocomplete Proxy
// Deploy this to Vercel (place in /api folder)

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');

  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers });
  }

  if (!query) {
    return new Response(JSON.stringify([]), { headers });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(query)}`,
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error('Google suggestions failed');
    }

    const data = await response.json();
    // Response format: [query, [suggestions]]
    const suggestions = Array.isArray(data[1]) ? data[1].slice(0, 8) : [];

    return new Response(JSON.stringify(suggestions), { headers });
  } catch (error) {
    console.error('Suggestions proxy error:', error);
    return new Response(JSON.stringify([]), { headers, status: 500 });
  }
}
