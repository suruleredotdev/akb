/**
 * akb UI — GeoView, ChronoView, EntityGraph, SearchResults
 * Reads from akb serve (http://localhost:8765)
 */

const API = "http://localhost:8765";
const SPAN_COLORS = { LOC: "#3b82f6", TIME: "#22c55e", PERSON: "#f59e0b",
                      ORG: "#a855f7", KEYWORD: "#06b6d4" };

// ── State ─────────────────────────────────────────────────────────────────────
let map = null;
let geoMarkers = [];
let allEntities = [];
let currentView = "search";

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  initTabs();
  initSearch();
  initMap();
  await loadBlocks();
  await loadGeo();
  await loadChrono();
  await loadEntities();
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      document.getElementById(`view-${view}`).classList.add("active");
      currentView = view;
      if (view === "geo" && map) setTimeout(() => map.invalidateSize(), 100);
      if (view === "entities") renderEntityGraph(allEntities);
    });
  });
}

// ── Blocks list ───────────────────────────────────────────────────────────────
async function loadBlocks() {
  const blocks = await apiFetch("/api/blocks");
  const list = document.getElementById("block-list");
  list.innerHTML = blocks.map(b =>
    `<div class="block-item" title="${b.source_url || ""}">${b.title || b.id}</div>`
  ).join("");
}

// ── Search ────────────────────────────────────────────────────────────────────
function initSearch() {
  const input = document.getElementById("query-input");
  const btn = document.getElementById("search-btn");
  btn.addEventListener("click", () => runSearch(input.value.trim()));
  input.addEventListener("keydown", e => { if (e.key === "Enter") runSearch(input.value.trim()); });
}

async function runSearch(query) {
  if (!query) return;
  switchToView("search");
  const results = await apiFetch(`/api/search?q=${encodeURIComponent(query)}&mode=hybrid&top_k=10`);
  renderResults(results, query);
}

function renderResults(results, query) {
  const list = document.getElementById("results-list");
  const answer = document.getElementById("llm-answer");
  answer.classList.add("hidden");

  if (!results.length) {
    list.innerHTML = `<p style="color:var(--text-dim)">No results for "${query}"</p>`;
    return;
  }

  list.innerHTML = results.map((r, i) => `
    <div class="result-card" data-chunk="${r.chunk_id}">
      <div class="result-header">
        <span class="result-title">${escHtml(r.block_title)}</span>
        <span class="result-pos">§${r.position} · ${r.rrf_score.toFixed(3)}</span>
      </div>
      <div class="result-text">${escHtml(r.text.slice(0, 300))}${r.text.length > 300 ? "…" : ""}</div>
      <div class="spans">${renderSpanTags(r.spans)}</div>
    </div>
  `).join("");
}

function renderSpanTags(spans) {
  return (spans || []).slice(0, 8).map(s =>
    `<span class="span-tag span-${s.span_type}" title="${escHtml(s.raw_text)}">
      ${s.span_type}: ${escHtml((s.normalized_value || s.raw_text || "").slice(0, 30))}
    </span>`
  ).join("");
}

// ── Map (GeoView) ─────────────────────────────────────────────────────────────
function initMap() {
  map = L.map("map", { center: [20, 20], zoom: 3 });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "© OpenStreetMap © CARTO", maxZoom: 19,
  }).addTo(map);
}

async function loadGeo() {
  const geojson = await apiFetch("/api/geo");
  if (!geojson || !geojson.features) return;

  geoMarkers.forEach(m => m.remove());
  geoMarkers = [];

  geojson.features.forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;
    const marker = L.circleMarker([lat, lon], {
      radius: 7, fillColor: SPAN_COLORS.LOC, color: "#fff",
      weight: 1, opacity: 0.9, fillOpacity: 0.7,
    });
    marker.bindPopup(`
      <strong>${escHtml(p.name)}</strong><br/>
      <em>${escHtml(p.block_title)}</em><br/>
      ${p.time_context ? `<span style="color:var(--time)">⏱ ${escHtml(p.time_context)}</span><br/>` : ""}
      <small>${escHtml(p.excerpt.slice(0, 150))}…</small>
    `);
    marker.addTo(map);
    geoMarkers.push(marker);
  });
}

window.exportGeo = async (fmt) => {
  window.open(`${API}/api/geo?format=${fmt}`, "_blank");
};

window.exportChrono = async (fmt) => {
  window.open(`${API}/api/chrono?format=${fmt}`, "_blank");
};

// ── Timeline (ChronoView) ──────────────────────────────────────────────────────
async function loadChrono() {
  const docs = await apiFetch("/api/chrono");
  const container = document.getElementById("timeline-container");
  if (!docs || !docs.length) {
    container.innerHTML = `<p style="color:var(--text-dim)">No temporal data. Run <code>akb resolve chrono --all</code></p>`;
    return;
  }

  // Flatten + sort all time spans
  const spans = docs.flatMap(doc =>
    (doc.timex_spans || []).map(s => ({ ...s, block_title: doc.block_title }))
  ).filter(s => s.iso_start).sort((a, b) => a.iso_start.localeCompare(b.iso_start));

  container.innerHTML = spans.map(s => `
    <div class="timeline-item">
      <div class="timeline-date">${escHtml(s.normalized_value || s.iso_start)}</div>
      <div class="timeline-content">
        <div class="timeline-source">${escHtml(s.block_title)}</div>
        <div class="timeline-text">${escHtml(s.excerpt.slice(0, 180))}…</div>
      </div>
    </div>
  `).join("");
}

// ── Entity Graph ───────────────────────────────────────────────────────────────
async function loadEntities() {
  allEntities = await apiFetch("/api/entities");
  if (currentView === "entities") renderEntityGraph(allEntities);

  document.getElementById("entity-type-filter").addEventListener("change", filterEntities);
  document.getElementById("entity-search").addEventListener("input", filterEntities);
}

function filterEntities() {
  const typeFilter = document.getElementById("entity-type-filter").value;
  const textFilter = document.getElementById("entity-search").value.toLowerCase();
  const filtered = allEntities.filter(e =>
    (!typeFilter || e.span_type === typeFilter) &&
    (!textFilter || (e.normalized_value || e.raw_text || "").toLowerCase().includes(textFilter))
  );
  renderEntityGraph(filtered);
}

function renderEntityGraph(entities) {
  const svg = document.getElementById("entity-graph");
  if (!svg) return;
  svg.innerHTML = "";

  const w = svg.clientWidth || 800;
  const h = svg.clientHeight || 500;

  // Build nodes (unique entities) and links (co-occurrence in same chunk)
  const nodeMap = new Map();
  const chunkToEntities = new Map();

  entities.forEach(e => {
    const key = `${e.span_type}:${e.normalized_value || e.raw_text}`;
    if (!nodeMap.has(key)) {
      nodeMap.set(key, { id: key, label: (e.normalized_value || e.raw_text || "").slice(0, 20),
                         type: e.span_type, count: 0 });
    }
    nodeMap.get(key).count++;

    if (e.chunk_id) {
      if (!chunkToEntities.has(e.chunk_id)) chunkToEntities.set(e.chunk_id, []);
      chunkToEntities.get(e.chunk_id).push(key);
    }
  });

  const nodes = [...nodeMap.values()].slice(0, 80); // cap for performance
  const nodeIds = new Set(nodes.map(n => n.id));
  const linkMap = new Map();

  chunkToEntities.forEach(keys => {
    const filtered = keys.filter(k => nodeIds.has(k));
    for (let i = 0; i < filtered.length; i++) {
      for (let j = i + 1; j < filtered.length; j++) {
        const lk = [filtered[i], filtered[j]].sort().join("||");
        linkMap.set(lk, (linkMap.get(lk) || 0) + 1);
      }
    }
  });

  const links = [...linkMap.entries()].map(([k, v]) => {
    const [s, t] = k.split("||");
    return { source: s, target: t, weight: v };
  }).slice(0, 200);

  const svgEl = d3.select(svg).attr("width", w).attr("height", h);

  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(d => d.id).distance(80))
    .force("charge", d3.forceManyBody().strength(-120))
    .force("center", d3.forceCenter(w / 2, h / 2))
    .force("collision", d3.forceCollide(18));

  const link = svgEl.append("g").selectAll("line").data(links).join("line")
    .attr("class", "link").attr("stroke-width", d => Math.min(d.weight, 3));

  const node = svgEl.append("g").selectAll("g").data(nodes).join("g")
    .attr("class", "node")
    .call(d3.drag()
      .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag",  (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end",   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  node.append("circle")
    .attr("r", d => 5 + Math.sqrt(d.count) * 2)
    .attr("fill", d => SPAN_COLORS[d.type] || "#888")
    .attr("fill-opacity", 0.75)
    .attr("stroke", d => SPAN_COLORS[d.type] || "#888");

  node.append("text").attr("x", 10).attr("dy", "0.35em").text(d => d.label);

  node.append("title").text(d => `${d.id} (${d.count} occurrences)`);

  sim.on("tick", () => {
    link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function apiFetch(path) {
  try {
    const resp = await fetch(API + path);
    if (!resp.ok) return null;
    return resp.json();
  } catch (e) {
    console.warn("API unavailable:", e.message);
    return null;
  }
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function switchToView(name) {
  document.querySelectorAll(".tab").forEach(t =>
    t.classList.toggle("active", t.dataset.view === name));
  document.querySelectorAll(".view").forEach(v =>
    v.classList.toggle("active", v.id === `view-${name}`));
  currentView = name;
}
