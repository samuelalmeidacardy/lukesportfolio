// Cloudflare Worker: Trading 212 API Proxy
// Forwards requests to T212 and adds CORS headers so browsers can call it.
//
// SETUP:
// 1. Go to https://dash.cloudflare.com → Workers & Pages → Create Worker
// 2. Paste this code in and deploy
// 3. Your proxy URL will be something like: https://t212-proxy.yourname.workers.dev
//
// USAGE:
// Browser calls:  https://your-worker.workers.dev/live/equity/history/dividends
// Worker calls:   https://live.trading212.com/api/v0/equity/history/dividends
//
// The Authorization header is passed straight through — your credentials
// never touch Cloudflare's storage, they're just forwarded per-request.

const ALLOWED_HOSTS = {
  'live': 'https://live.trading212.com/api/v0',
  'demo': 'https://demo.trading212.com/api/v0',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname; // e.g. /live/equity/history/dividends

    // Extract environment (live or demo) from the first path segment
    const parts = path.split('/').filter(Boolean);
    if (parts.length < 1) {
      return jsonResponse(400, { error: 'Missing environment. Use /live/... or /demo/...' });
    }

    const env = parts[0]; // "live" or "demo"
    const targetBase = ALLOWED_HOSTS[env];
    if (!targetBase) {
      return jsonResponse(400, { error: 'Invalid environment. Use /live/ or /demo/' });
    }

    // Build the target URL
    const apiPath = '/' + parts.slice(1).join('/') + url.search;
    const targetUrl = targetBase + apiPath;

    // Forward the request
    const headers = new Headers();
    if (request.headers.has('Authorization')) {
      headers.set('Authorization', request.headers.get('Authorization'));
    }
    headers.set('Content-Type', 'application/json');

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });

      // Clone response and add CORS headers
      const responseHeaders = new Headers(response.headers);
      Object.entries(CORS_HEADERS).forEach(([k, v]) => responseHeaders.set(k, v));

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return jsonResponse(502, { error: 'Failed to reach Trading 212: ' + err.message });
    }
  }
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
