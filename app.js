'use strict';

const STORE_KEY = 'ci-picks-v1';
const LIST_CAP = 150;
const COLORS = ['#d9480f', '#7048e8', '#1c7ed6', '#2f9e44', '#c2255c', '#e8590c', '#0c8599', '#5c940d', '#862e9c'];

const $ = (id) => document.getElementById(id);
const state = {
  places: [], visible: [], newIds: new Set(), cats: [], counts: {}, colors: {},
  activeCats: new Set(), onlyNew: false, query: '', me: null,
};

// ---------- storage ----------
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch { return null; }
}
function saveStore(data) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); return true; } catch { return false; }
}

// ---------- KML parsing ----------
function cleanCat(name) {
  return name.replace(/\s*\(.*\)\s*$/, '').trim();
}
function cleanDesc(html) {
  if (!html) return '';
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent || '').trim();
}
// Members flag closures in the name/notes ("Permanently Closed", "(closed)", or a note that's just "CLOSED").
function isClosed(name, desc) {
  return /permanently closed|closed permanently|\(closed\)/i.test(`${name} ${desc}`) || /^closed[.!]?$/i.test(desc);
}
function parseKml(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error("That file isn't valid KML.");
  if (!xml.querySelector('Placemark') && xml.querySelector('NetworkLink')) {
    throw new Error('That KML is only a network link with no places in it. Use the "live KML download" link instead.');
  }
  const places = [];
  for (const folder of xml.querySelectorAll('Folder')) {
    const folderName = folder.querySelector(':scope > name')?.textContent || 'Other';
    if (/^Directions from/i.test(folderName)) continue;
    const cat = cleanCat(folderName);
    for (const pm of folder.querySelectorAll(':scope > Placemark')) {
      const coords = pm.querySelector('Point > coordinates')?.textContent.trim();
      if (!coords) continue;
      const [lng, lat] = coords.split(',').map(Number);
      if (!isFinite(lat) || !isFinite(lng)) continue;
      const name = pm.querySelector(':scope > name')?.textContent.trim() || '(unnamed)';
      const desc = cleanDesc(pm.querySelector(':scope > description')?.textContent);
      if (isClosed(name, desc)) continue;
      const id = `${name.toLowerCase()}@${lat.toFixed(4)},${lng.toFixed(4)}`;
      places.push({ id, name, desc, cat, lat, lng });
    }
  }
  if (!places.length) throw new Error('No places found in that file.');
  return places;
}

// ---------- geo ----------
function distMi(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtDist(mi) {
  return mi < 0.1 ? `${Math.round(mi * 5280)} ft` : mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
}

// ---------- map ----------
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const map = L.map('map', { preferCanvas: true, zoomControl: false, worldCopyJump: true }).setView([39.5, -98.35], 4);
L.control.zoom({ position: 'topright' }).addTo(map);
// Esri gray canvas: no businesses/POIs drawn, just streets + labels, and no API key.
const esri = (layer) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${layer}/MapServer/tile/{z}/{y}/{x}`;
const tileOpts = { maxZoom: 19, maxNativeZoom: 16 };
L.tileLayer(esri(dark ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base'), {
  ...tileOpts, attribution: '&copy; Esri, HERE, Garmin, OSM',
}).addTo(map);
L.tileLayer(esri(dark ? 'World_Dark_Gray_Reference' : 'World_Light_Gray_Reference'), tileOpts).addTo(map);
const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, chunkedLoading: true });
map.addLayer(cluster);
let meMarker = null;
const markers = new Map(); // id -> marker

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const newBadge = (p) => (state.newIds.has(p.id) ? ' <span class="new">New</span>' : '');
// Shared by the map popup and the list row: category, notes, and links.
function detailsHtml(p) {
  const dir = `https://maps.apple.com/?daddr=${p.lat},${p.lng}`;
  const gm = `https://www.google.com/maps/search/${encodeURIComponent(p.name)}/@${p.lat},${p.lng},17z`;
  return `<div class="cat">${esc(p.cat)}</div>${p.desc ? `<p>${esc(p.desc)}</p>` : ''}
    <div class="links"><a href="${dir}" target="_blank" rel="noopener">Directions</a><a href="${gm}" target="_blank" rel="noopener">Google Maps</a></div>`;
}

function buildMarkers() {
  markers.clear();
  for (const p of state.places) {
    const m = L.circleMarker([p.lat, p.lng], {
      radius: 7, weight: 2, color: '#fff', fillColor: state.colors[p.cat], fillOpacity: 0.95,
    }).bindPopup(() => `<div class="pop"><b>${esc(p.name)}</b>${newBadge(p)}${detailsHtml(p)}</div>`, { maxWidth: 280 });
    markers.set(p.id, m);
  }
}

// ---------- filtering & rendering ----------
function matches(p) {
  if (state.onlyNew && !state.newIds.has(p.id)) return false;
  if (!state.activeCats.has(p.cat)) return false;
  if (state.query) {
    const q = state.query;
    if (!p.name.toLowerCase().includes(q) && !p.desc.toLowerCase().includes(q)) return false;
  }
  return true;
}

function refreshMap() {
  state.visible = state.places.filter(matches);
  cluster.clearLayers();
  cluster.addLayers(state.visible.map((p) => markers.get(p.id)));
  renderList();
}

function renderList() {
  // With a search or "New" filter, list every match; otherwise only what's in view.
  const global = !!state.query || state.onlyNew;
  const bounds = map.getBounds();
  const pool = global ? state.visible : state.visible.filter((p) => bounds.contains([p.lat, p.lng]));
  const c = map.getCenter();
  const origin = state.me || { lat: c.lat, lng: c.lng };
  const rows = pool.map((p) => ({ p, d: distMi(origin, p) })).sort((a, b) => a.d - b.d);

  $('listMeta').textContent = global
    ? `${rows.length} match${rows.length === 1 ? '' : 'es'}${state.me ? ' · nearest first' : ''}`
    : `${rows.length} in view${state.me ? ' · nearest to you first' : ''}${rows.length > LIST_CAP ? ` · showing ${LIST_CAP}` : ''}`;

  $('list').innerHTML = rows.slice(0, LIST_CAP).map(({ p, d }) => `
    <li data-id="${esc(p.id)}">
      <div class="row1"><span class="dot" style="background:${state.colors[p.cat]}"></span>
        <b>${esc(p.name)}</b>${newBadge(p)}
        <span class="dist">${state.me || global ? fmtDist(d) : ''}</span></div>
      ${detailsHtml(p)}
    </li>`).join('');
}

function renderChips() {
  const chips = state.cats.map((cat) => `
    <button class="chip ${state.activeCats.has(cat) ? 'on' : ''}" data-cat="${esc(cat)}" style="--c:${state.colors[cat]}">
      ${esc(cat)} <small>${state.counts[cat]}</small></button>`);
  if (state.newIds.size) {
    chips.unshift(`<button class="chip new-chip ${state.onlyNew ? 'on' : ''}" data-new="1" style="--c:#f59f00">
      New <small>${state.newIds.size}</small></button>`);
  }
  $('chips').innerHTML = chips.join('');
}

// ---------- data lifecycle ----------
function setData(data) {
  state.places = data.places;
  state.newIds = new Set(data.newIds || []);
  state.counts = {};
  for (const p of state.places) state.counts[p.cat] = (state.counts[p.cat] || 0) + 1;
  state.cats = Object.keys(state.counts).sort((a, b) => state.counts[b] - state.counts[a]);
  state.colors = Object.fromEntries(state.cats.map((c, i) => [c, COLORS[i % COLORS.length]]));
  state.activeCats = new Set(state.cats);
  state.onlyNew = false;
  buildMarkers();
  renderChips();
  refreshMap();
  $('empty').hidden = true;
  $('loadBtn').title = `Loaded ${new Date(data.loadedAt).toLocaleString()}. Tap to load a newer KML.`;
}

async function handleFile(file) {
  try {
    const places = parseKml(await file.text());
    const prev = loadStore();
    const prevIds = prev ? new Set(prev.places.map((p) => p.id)) : null;
    const newIds = prevIds ? places.filter((p) => !prevIds.has(p.id)).map((p) => p.id) : [];
    const data = { loadedAt: Date.now(), places, newIds };
    if (!saveStore(data)) alert("Loaded, but this browser wouldn't save it, so you'll need to load the file again next time.");
    setData(data);
    if (!prev) map.fitBounds(L.latLngBounds(places.map((p) => [p.lat, p.lng])), { padding: [20, 20] });
    toast(`${places.length} places loaded${prevIds ? ` · ${newIds.length} new` : ''}`);
  } catch (e) {
    alert(e.message);
  }
}

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ---------- events ----------
const pickFile = () => $('file').click();
$('loadBtn').onclick = pickFile;
$('emptyLoad').onclick = pickFile;
$('file').onchange = (e) => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; };

let searchTimer;
$('search').oninput = (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = e.target.value.trim().toLowerCase(); refreshMap(); }, 150);
};

$('chips').onclick = (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  if (b.dataset.new) state.onlyNew = !state.onlyNew;
  else {
    const cat = b.dataset.cat;
    // First tap on a fully-enabled set isolates that category; afterwards chips toggle.
    if (state.activeCats.size === state.cats.length) state.activeCats = new Set([cat]);
    else if (state.activeCats.has(cat)) state.activeCats.delete(cat);
    else state.activeCats.add(cat);
    if (!state.activeCats.size) state.activeCats = new Set(state.cats);
  }
  renderChips();
  refreshMap();
};

$('nearMe').onclick = () => {
  if (!navigator.geolocation) return alert("This browser can't share your location.");
  $('nearMe').classList.add('busy');
  navigator.geolocation.getCurrentPosition((pos) => {
    $('nearMe').classList.remove('busy');
    state.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (meMarker) meMarker.setLatLng(state.me);
    else meMarker = L.circleMarker(state.me, { radius: 8, color: '#fff', weight: 3, fillColor: '#228be6', fillOpacity: 1 }).addTo(map);
    // Frame you plus your 10 nearest (filtered) picks, so sparse areas still show something.
    const nearest = state.visible
      .map((p) => ({ p, d: distMi(state.me, p) })).sort((a, b) => a.d - b.d).slice(0, 10);
    const pts = [[state.me.lat, state.me.lng], ...nearest.map(({ p }) => [p.lat, p.lng])];
    map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 15 });
    renderList();
  }, (err) => {
    $('nearMe').classList.remove('busy');
    alert(`Couldn't get your location: ${err.message}`);
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
};

$('list').onclick = (e) => {
  if (e.target.closest('a')) return;
  const li = e.target.closest('li');
  if (!li) return;
  const m = markers.get(li.dataset.id);
  if (document.querySelector('main').dataset.sheet === 'full') document.querySelector('main').dataset.sheet = 'half';
  cluster.zoomToShowLayer(m, () => m.openPopup());
};

$('handle').onclick = () => {
  const main = document.querySelector('main');
  const order = ['half', 'full', 'min'];
  main.dataset.sheet = order[(order.indexOf(main.dataset.sheet) + 1) % order.length];
  setTimeout(() => map.invalidateSize(), 250);
};

map.on('moveend', () => { if (!state.query && !state.onlyNew) renderList(); });

// ---------- boot ----------
const saved = loadStore();
if (saved?.places?.length) setData(saved);
else $('empty').hidden = false;
