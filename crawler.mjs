import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const ALLOWED_HOSTS = new Set(['shopeefood.vn', 'www.shopeefood.vn', 'shopeefood.shopee.vn']);
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const MAX_TABS = 3;      // concurrent Chrome pages
const MAX_WAITING = 10;  // crawls queued behind them before we refuse
const cache = new Map();
// Long-lived index of crawled shops, used only to render link previews for shared results
const SHARE_INDEX_MAX = 500;
const shareIndex = new Map();

let active = 0;
const waiting = [];
async function withSlot(fn) {
  if (active >= MAX_TABS) {
    if (waiting.length >= MAX_WAITING) throw new Error('Server đang bận, thử lại sau ít giây nhé');
    await new Promise(resolve => waiting.push(resolve));
  }
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

let browserPromise;
function getBrowser() {
  browserPromise ??= puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  return browserPromise;
}

export function validateUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw new Error('Link không hợp lệ'); }
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error('Chỉ hỗ trợ link shopeefood.vn hoặc shopeefood.shopee.vn (vd: https://shopeefood.vn/u/xxxx)');
  }
  return u.toString();
}

// Collapse the raw menu into unique, orderable dishes.
function normalize(detail, menuInfos) {
  const seen = new Map();
  // Promo groups (negative ids, e.g. "Món Đang Giảm") repeat dishes from the real
  // categories, so visit real categories first to keep the meaningful group name.
  const groups = [...menuInfos].sort((a, b) => (a.dish_type_id < 0) - (b.dish_type_id < 0));
  for (const group of groups) {
    for (const d of group.dishes || []) {
      if (seen.has(d.id) || d.is_deleted || !d.is_active || !d.is_available) continue;
      // Shops often add 1đ placeholder items ("Gọi quán ...") that are not real food.
      if ((d.price?.value ?? 0) < 1000) continue;
      const photo = (d.photos || []).find(p => p.width >= 180) || d.photos?.[0];
      seen.set(d.id, {
        id: d.id,
        name: d.name.trim(),
        price: d.discount_price?.value ?? d.price.value,
        priceText: d.discount_price?.text ?? d.price.text,
        category: group.dish_type_name,
        image: photo?.value || null,
      });
    }
  }
  return {
    shop: { name: detail?.name ?? '', address: detail?.address ?? '' },
    dishes: [...seen.values()],
  };
}

// True when the menu is served from cache, so it costs no crawl (and no rate-limit hit)
export function menuCached(rawUrl) {
  try {
    const hit = cache.get(validateUrl(rawUrl));
    return !!hit && Date.now() - hit.at < CACHE_TTL_MS;
  } catch { return false; }
}

export async function crawlMenu(rawUrl) {
  const url = validateUrl(rawUrl);
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  return withSlot(() => crawl(url));
}

async function crawl(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // ShopeeFood's API rejects unsigned requests, so let the real web app make
    // the calls and capture its responses.
    let detail = null;
    const dishesResp = page.waitForResponse(
      r => r.url().includes('/api/dish/get_delivery_dishes') && r.request().method() !== 'OPTIONS' && r.status() === 200,
      { timeout: 45000 },
    );
    page.on('response', async r => {
      if (!r.url().includes('/api/delivery/get_detail') || r.request().method() === 'OPTIONS') return;
      try { detail = (await r.json())?.reply?.delivery_detail ?? detail; } catch {}
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const json = await (await dishesResp).json();
    const menu = json?.reply?.menu_infos;
    if (!Array.isArray(menu)) throw new Error('Không đọc được thực đơn của quán');
    const data = normalize(detail, menu);
    if (!data.dishes.length) throw new Error('Quán hiện không có món nào đang bán');
    if (shareIndex.size >= SHARE_INDEX_MAX) shareIndex.delete(shareIndex.keys().next().value);
    shareIndex.set(url, data);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(url, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Error('Không tải được thực đơn — link có đúng là link quán không? Thử lại sau nhé');
    throw e;
  } finally {
    await page.close().catch(() => {});
  }
}

// Look up an already-crawled dish without launching Chrome (null when unknown)
export function peekDish(rawUrl, dishId) {
  let url;
  try { url = validateUrl(rawUrl); } catch { return null; }
  const data = shareIndex.get(url);
  const dish = data?.dishes.find(d => String(d.id) === String(dishId));
  return dish ? { shop: data.shop, dish } : null;
}

export async function closeBrowser() {
  if (browserPromise) await (await browserPromise).close();
}

// ---- Nearby shops -------------------------------------------------------
// ShopeeFood's web listing ignores the user's location, so we load a city's
// listing filtered to the districts closest to the user and sort by distance.
const META_TTL_MS = 24 * 60 * 60 * 1000;
const NEARBY_TTL_MS = 45 * 60 * 1000;
const NEARBY_MAX = 100;
const nearbyCache = new Map();
let meta = null;

function km(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180;
  const h = Math.sin((bLat - aLat) * r / 2) ** 2
    + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin((bLng - aLng) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// The plain listing only holds a few promoted shops per district; a broad
// keyword search returns far more and is paginated.
const listingUrl = (slug, q) => `https://shopeefood.vn/${slug}/food/danh-sach-dia-diem-giao-tan-noi${q ? `?q=${encodeURIComponent(q)}` : ''}`;
const NEARBY_KEYWORD = 'đồ ăn';

function parseMeta(reply) {
  const cities = (reply?.country?.cities || []).map(c => ({
    id: c.id, name: c.name, slug: c.url_rewrite_name, lat: c.latitude, lng: c.longitude,
    districts: (c.districts || []).map(d => ({ id: d.district_id, name: d.name, lat: d.latitude, lng: d.longitude })),
  })).filter(c => c.slug && c.districts.length);
  return cities.length ? cities : null;
}

// Open a listing page and record metadata + every shop the page loads.
async function openListing(page, slug, q) {
  const infos = new Map();
  let metaReply = null;
  page.on('response', async r => {
    if (r.request().method() !== 'POST' && !r.url().includes('get_metadata')) return;
    try {
      if (r.url().includes('/api/meta/get_metadata')) metaReply = (await r.json())?.reply;
      else if (r.url().includes('/api/delivery/get_infos')) {
        for (const i of (await r.json())?.reply?.delivery_infos || []) infos.set(i.restaurant_id, i);
      }
    } catch {}
  });
  await page.goto(listingUrl(slug, q), { waitUntil: 'networkidle2', timeout: 45000 }).catch(e => {
    if (e.name !== 'TimeoutError') throw e;
  });
  return { infos, getMeta: () => metaReply };
}

async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 250)); }
  return false;
}

export async function getAreas() {
  if (meta && Date.now() - meta.at < META_TTL_MS) return meta.cities;
  return withSlot(async () => {
    if (meta && Date.now() - meta.at < META_TTL_MS) return meta.cities;
    const page = await (await getBrowser()).newPage();
    try {
      const { getMeta } = await openListing(page, 'ha-noi');
      await waitFor(getMeta, 15000);
      const cities = parseMeta(getMeta());
      if (!cities) throw new Error('Không lấy được danh sách khu vực của ShopeeFood');
      meta = { at: Date.now(), cities };
      return cities;
    } finally { await page.close().catch(() => {}); }
  });
}

// Minutes since midnight in Vietnam (UTC+7, no DST), independent of the server's own timezone
const vnMinutes = () => { const d = new Date(Date.now() + 7 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const CLOSING_SOON_MIN = 30;   // a shop that closes within this window can't deliver in time, so treat it as closed
const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
// Minutes left until closing now, or null when the hours are unknown / the shop runs around the clock
function minutesToClose(op) {
  const o = toMin(op?.open_time), c = toMin(op?.close_time);
  if (o == null || c == null) return null;
  if (o === 0 && c >= 1439) return null;   // 00:00 to 23:59 = open all day
  const now = vnMinutes();
  if (o <= c) return now >= o && now <= c ? c - now : -1;   // -1: outside today's hours
  return now >= o ? c + 1440 - now : now <= c ? c - now : -1;   // overnight, e.g. 18:00 to 02:00
}
const hhmm = t => (t || '').slice(0, 5);

function shopOut(i, city, lat, lng) {
  const photo = (i.photos || []).reduce((best, p) => (!best || p.width > best.width ? p : best), null);
  const pos = i.position || {};
  return {
    id: i.restaurant_id,
    name: (i.name || '').trim(),
    address: i.address || '',
    url: `https://shopeefood.vn/${city.slug}/${i.restaurant_url}`,
    image: photo?.value || null,
    km: pos.latitude ? Math.round(km(lat, lng, pos.latitude, pos.longitude) * 10) / 10 : null,
    rating: i.rating?.avg ? Math.round(i.rating.avg * 10) / 10 : null,
    // Judged from the opening hours at request time (the crawl itself can be minutes old)
    open: i.is_open !== false && !((m => m != null && m < CLOSING_SOON_MIN)(minutesToClose(i.operating))),
    hours: i.operating?.open_time && i.operating?.close_time ? `${hhmm(i.operating.open_time)}–${hhmm(i.operating.close_time)}` : '',
  };
}

export async function crawlNearby(lat, lng) {
  const cities = await getAreas();
  const city = cities.reduce((a, c) => (km(lat, lng, c.lat, c.lng) < km(lat, lng, a.lat, a.lng) ? c : a));
  const ranked = city.districts.map(d => ({ ...d, dist: km(lat, lng, d.lat, d.lng) })).sort((a, b) => a.dist - b.dist);
  // The closest district plus neighbours whose centre is within 6 km (max 5)
  const picked = ranked.filter((d, k) => k === 0 || (k < 5 && d.dist < 6));
  const key = `${city.id}:${picked.map(d => d.id).join(',')}`;

  let hit = nearbyCache.get(key);
  if (!hit || Date.now() - hit.at > NEARBY_TTL_MS) {
    const raw = await withSlot(() => crawlDistricts(city, picked));
    if (nearbyCache.size >= NEARBY_MAX) nearbyCache.delete(nearbyCache.keys().next().value);
    hit = { at: Date.now(), raw };
    nearbyCache.set(key, hit);
  }
  const shops = hit.raw
    .filter(i => i.restaurant_url)
    .map(i => shopOut(i, city, lat, lng))
    .sort((a, b) => (a.km ?? 99) - (b.km ?? 99))
    .slice(0, 40);
  return { city: city.name, districts: picked.map(d => d.name), shops };
}

async function crawlDistricts(city, districts) {
  const page = await (await getBrowser()).newPage();
  try {
    await page.setViewport({ width: 1300, height: 900 });
    const { infos } = await openListing(page, city.slug, NEARBY_KEYWORD);
    await waitFor(() => infos.size, 15000);
    infos.clear();
    const ok = await page.evaluate(ids => {
      for (const box of document.querySelectorAll('input[id^="district "]')) {
        if (box.checked !== ids.includes(box.id)) box.click();
      }
      const btn = [...document.querySelectorAll('.btn-red')].find(b => b.textContent.trim() === 'Ok');
      btn?.click();
      return !!btn;
    }, districts.map(d => `district ${d.id}`));
    if (!ok) throw new Error('Không lọc được quán theo khu vực');
    await waitFor(() => infos.size, 10000);
    // Walk a few result pages
    for (let k = 0; k < 5; k++) {
      const before = infos.size;
      const next = await page.evaluate(() => {
        const icon = document.querySelector('.pagination .icon-paging-next');
        const el = icon?.closest('a,button,li') || icon?.parentElement;
        if (!el || /disabled/.test(el.className)) return false;
        el.click();
        return true;
      });
      if (!next || !(await waitFor(() => infos.size > before, 6000))) break;
    }
    if (!infos.size) throw new Error('Không tìm thấy quán nào quanh bạn');
    return [...infos.values()];
  } finally {
    await page.close().catch(() => {});
  }
}
