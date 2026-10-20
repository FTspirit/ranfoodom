import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlMenu, menuCached, closeBrowser, peekDish, crawlNearby, getAreas } from './crawler.mjs';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

// ---- live feed: who spun / picked what. In memory only (no DB): last FEED_MAX events, lost on restart ----
const FEED_MAX = 30;
const feed = [];
const clients = new Set();
const lastPost = new Map();   // ip -> recent post timestamps; max 8 per 10s
// Behind Cloudflare Tunnel the real client IP arrives in cf-connecting-ip
const clientIp = req => req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
function limited(map, key, max, windowMs) {
  const now = Date.now();
  const recent = (map.get(key) || []).filter(t => now - t < windowMs);
  if (map.size > 5000) map.clear();
  map.set(key, [...recent, now]);
  return recent.length >= max;
}
const menuHits = new Map();   // ip -> recent uncached /api/menu crawls; max 20 per minute (offices share one IP)
const nearbyHits = new Map(); // ip -> recent /api/nearby timestamps; max 6 per minute
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > limit) { reject(new Error('Payload too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function broadcast(ev) {
  feed.push(ev);
  if (feed.length > FEED_MAX) feed.shift();
  const msg = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

async function handleEvent(req, res) {
  const now = Date.now();
  if (limited(lastPost, clientIp(req), 8, 10000)) return send(res, 429, { error: 'Chậm lại xíu' });
  let b;
  try { b = await readJson(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const user = clip(b.user, 20), dish = clip(b.dish, 100);
  if (!/^user_\d{4}$/.test(user) || !dish || !['spin', 'pick'].includes(b.kind)) {
    return send(res, 400, { error: 'Invalid event' });
  }
  const ev = { id: `${now}-${Math.random().toString(36).slice(2, 7)}`, at: now, kind: b.kind, user, dish, shop: clip(b.shop, 100) };
  broadcast(ev);
  send(res, 201, ev);
}

function handleStream(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(`event: backlog\ndata: ${JSON.stringify(feed)}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// ---- link previews (Open Graph) for the index page and shared results ----
const esc = v => String(v).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const bigImage = u => (u && /^https:\/\/[\w.-]+\.susercontent\.com\//.test(u) ? u.split('@')[0] : null);
function ogTags(req, searchParams) {
  const origin = process.env.PUBLIC_URL || `https://${req.headers.host}`;
  let title = 'Hôm nay ăn gì? Vòng quay món ShopeeFood';
  let desc = 'Dán link quán ShopeeFood, quay một vòng, để vũ trụ chọn món giúp bạn.';
  let image = `${origin}/og.png`;
  const hit = searchParams.get('url') && searchParams.get('d') ? peekDish(searchParams.get('url'), searchParams.get('d')) : null;
  if (hit) {
    const by = /^user_\d{4}$/.test(searchParams.get('by') || '') ? searchParams.get('by') : 'Ai đó';
    title = `${by} đã quay ra món ${hit.dish.name}`;
    desc = `${hit.dish.priceText} tại ${hit.shop.name || 'ShopeeFood'}. Bấm vào để quay thử lượt của bạn!`;
    image = bigImage(hit.dish.image) || image;
  }
  return [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Hôm nay ăn gì?">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="description" content="${esc(desc)}">`,
  ].join('\n');
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  // Always revalidate, so phones pick up a redeploy instead of running an old page
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-cache' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/menu' && req.method === 'GET') {
    const menuUrl = searchParams.get('url') || '';
    if (!menuCached(menuUrl) && limited(menuHits, clientIp(req), 20, 60000)) return send(res, 429, { error: 'Bạn lấy thực đơn nhiều quá, đợi 1 phút rồi thử lại nhé' });
    try {
      send(res, 200, await crawlMenu(menuUrl));
    } catch (e) {
      console.error('[menu]', e.message);
      send(res, 400, { error: e.message });
    }
    return;
  }
  if (pathname === '/api/nearby' && req.method === 'GET') {
    const lat = Number(searchParams.get('lat')), lng = Number(searchParams.get('lng'));
    // Vietnam's bounding box, roughly
    if (!(lat >= 8 && lat <= 24 && lng >= 102 && lng <= 110)) return send(res, 400, { error: 'Vị trí nằm ngoài Việt Nam, chọn khu vực bằng tay nhé' });
    if (limited(nearbyHits, clientIp(req), 6, 60000)) return send(res, 429, { error: 'Bạn tìm quán nhiều quá, đợi 1 phút rồi thử lại nhé' });
    try {
      send(res, 200, await crawlNearby(lat, lng));
    } catch (e) {
      console.error('[nearby]', e.message);
      send(res, 400, { error: e.name === 'TimeoutError' ? 'ShopeeFood phản hồi chậm, thử lại sau nhé' : e.message });
    }
    return;
  }
  if (pathname === '/api/areas' && req.method === 'GET') {
    try {
      const cities = await getAreas();
      send(res, 200, cities.map(c => ({ id: c.id, name: c.name, districts: c.districts.map(d => ({ id: d.id, name: d.name, lat: d.lat, lng: d.lng })) })));
    } catch (e) {
      console.error('[areas]', e.message);
      send(res, 400, { error: e.message });
    }
    return;
  }
  if (pathname === '/api/events' && req.method === 'POST') return handleEvent(req, res);
  if (pathname === '/api/events/stream' && req.method === 'GET') return handleStream(req, res);
  if (pathname === '/' || pathname === '/index.html') {
    const html = await fs.readFile(path.join(PUBLIC, 'index.html'), 'utf8');
    return send(res, 200, html.replace('<!--og-->', ogTags(req, searchParams)), TYPES['.html']);
  }
  const file = path.join(PUBLIC, path.normalize(pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    send(res, 200, await fs.readFile(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
});

server.listen(PORT, () => console.log(`Vòng quay món ăn: http://localhost:${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await closeBrowser(); process.exit(0); });
}
