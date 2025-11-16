// /js/heatmap.js
// Initializes Leaflet map in #map, fetches heatmap points from backend
// and draws circleMarkers colored by safety score.
// Expects api.js at /js/api.js exporting default methods (get/post).
// If api.js is missing, this falls back to fetch() to /api/heatmap_data.

const DEFAULT_CENTER = [12.97, 77.59];
const DEFAULT_ZOOM = 13;
const MAP_ID = 'map';

// Utility: color by score 0..1
function scoreToColor(score) {
  // green (safe) -> yellow -> red (unsafe)
  const r = Math.round(Math.min(255, Math.max(0, 255 * (1 - score) * 1.6))); // more red when low score
  const g = Math.round(Math.min(255, Math.max(0, 255 * score * 1.2)));
  const b = 40;
  return `rgb(${r},${g},${b})`;
}

// Utility: create CSV text from points
function pointsToCSV(points) {
  const headers = ['lat', 'lng', 'score', 'samples', 'confidence'];
  const rows = points.map(p => [
    p.lat, p.lng, (p.score ?? ''), (p.samples ?? ''), (p.confidence ?? '')
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  return csv;
}

async function safeApiGet(path, params = {}) {
  // Prefer your api.js wrapper if available
  try {
    // dynamic import so missing file doesn't throw at top-level import time
    const api = await import('/js/api.js').then(m => m.default).catch(() => null);
    if (api && typeof api.get === 'function') {
      return await api.get(path, { params });
    }
  } catch (e) {
    console.warn('api.js import/get failed - falling back to fetch', e);
  }

  // fallback: basic fetch (assumes PATH accepts query params 'band' and 'min_samples' and 'bbox')
  const u = new URL(path, window.location.origin);
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) u.searchParams.set(k, v); });
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

function showMapScore(point) {
  const scoreEl = document.getElementById('scoreValue');
  const samplesEl = document.getElementById('scoreSamples');
  const mapScore = document.getElementById('mapScore');
  if (!scoreEl || !samplesEl || !mapScore) return;
  scoreEl.innerText = (point.score !== undefined && point.score !== null) ? (Number(point.score).toFixed(2)) : '—';
  samplesEl.innerText = `samples: ${point.samples ?? '—'}`;
  mapScore.style.display = 'block';
  mapScore.setAttribute('aria-hidden', 'false');
}

function hideMapScore() {
  const mapScore = document.getElementById('mapScore');
  if (!mapScore) return;
  mapScore.style.display = 'none';
  mapScore.setAttribute('aria-hidden', 'true');
}

export async function initHeatmapPage({ band = 'night', min_samples = 1 } = {}) {
  // If map already exists on page, don't re-init (useful if file included twice)
  if (!document.getElementById(MAP_ID)) {
    console.error(`#${MAP_ID} element not found in DOM`);
    return;
  }

  // require Leaflet to be loaded
  if (typeof L === 'undefined') {
    console.error('Leaflet (L) is not loaded. Make sure you included Leaflet JS before this module.');
    // keep "Loading map…" text visible so user sees error
    document.getElementById(MAP_ID).innerText = 'Map initialization failed (Leaflet missing). Check console.';
    return;
  }

  // create map container if not already initialised
  // We store map instance on window so re-runs can reuse
  if (window._sarthi_heatmap_map) {
    // map exists; update params and trigger fetch
    window._sarthi_heatmap_params = { band, min_samples };
    if (window._sarthi_heatmap_controller && typeof window._sarthi_heatmap_controller.fetchAndRender === 'function') {
      await window._sarthi_heatmap_controller.fetchAndRender();
    }
    return window._sarthi_heatmap_controller;
  }

  const map = L.map(MAP_ID).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  // tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // layers
  const markersLayer = L.layerGroup().addTo(map);
  const clusters = []; // keep list if needed
  let lastFetchedPoints = [];

  // controller object we return
  const controller = {
    map,
    markersLayer,
    lastFetchedPoints,
    params: { band, min_samples },
    async fetchAndRender({ band: b, min_samples: ms } = {}) {
      const params = {
        band: (b ?? controller.params.band),
        min_samples: (ms ?? controller.params.min_samples)
      };
      controller.params = params;

      // get bbox for backend
      const bounds = map.getBounds();
      const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

      // show feedback
      const feedback = document.getElementById('formFeedback');
      if (feedback) { feedback.innerText = 'Loading points...'; }

      try {
        // backend path: /api/heatmap_data (as in your backend summary)
        const data = await safeApiGet('/api/heatmap_data', { band: params.band, min_samples: params.min_samples, bbox });
        // Expecting array of {lat,lng,score,samples,confidence}
        const pts = Array.isArray(data) ? data : (data.points || data.data || []);
        lastFetchedPoints = pts;
        controller.lastFetchedPoints = pts;

        // Clear old markers
        markersLayer.clearLayers();
        hideMapScore();

        // Create circle markers (colored by score)
        pts.forEach(p => {
          if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
          const score = (p.score !== undefined && p.score !== null) ? Number(p.score) : 0.5;
          const samples = p.samples ?? 1;
          const radius = Math.max(6, Math.min(25, samples * 2));
          const color = scoreToColor(score);
          const marker = L.circleMarker([p.lat, p.lng], {
            radius,
            fillColor: color,
            color: 'rgba(255,255,255,0.06)',
            weight: 1,
            fillOpacity: 0.9
          });

          const popupHtml = `<div style="min-width:120px">
            <strong>Score:</strong> ${Number(score).toFixed(2)}<br/>
            <strong>Samples:</strong> ${samples}<br/>
            <strong>Confidence:</strong> ${p.confidence ?? '—'}</div>`;

          marker.bindPopup(popupHtml);
          marker.on('click', () => {
            showMapScore({ score, samples, confidence: p.confidence });
          });

          markersLayer.addLayer(marker);
        });

        if (feedback) feedback.innerText = `${pts.length} points loaded.`;
        return pts;
      } catch (err) {
        console.error('Failed to fetch heatmap data', err);
        if (feedback) feedback.innerText = `Failed to load data: ${err.message || err}`;
        throw err;
      }
    },

    // helpers
    toggleMarkers() {
      if (map.hasLayer(markersLayer)) {
        map.removeLayer(markersLayer);
      } else {
        map.addLayer(markersLayer);
      }
    },

    resetView() {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    },

    exportCSV() {
      if (!controller.lastFetchedPoints || !controller.lastFetchedPoints.length) {
        alert('No data to export.');
        return;
      }
      const csv = pointsToCSV(controller.lastFetchedPoints);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `heatmap_points_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  };

  // save global references so re-initializing works
  window._sarthi_heatmap_map = map;
  window._sarthi_heatmap_controller = controller;
  window._sarthi_heatmap_params = controller.params;

  // wire map events (moveend -> reload)
  let fetchTimeout = null;
  map.on('moveend', () => {
    // small debounce
    if (fetchTimeout) clearTimeout(fetchTimeout);
    fetchTimeout = setTimeout(() => controller.fetchAndRender(), 300);
  });

  // wire DOM controls if present
  try {
    const bandSelect = document.getElementById('bandSelect');
    const samplesRange = document.getElementById('samplesRange');
    const applyBtn = document.getElementById('applyBtn');
    const toggleBtn = document.getElementById('toggleMarkers');
    const resetBtn = document.getElementById('resetView');
    const downloadBtn = document.getElementById('downloadBtn');
    const samplesValue = document.getElementById('samplesValue');

    if (samplesRange && samplesValue) {
      samplesRange.addEventListener('input', (e) => {
        samplesValue.innerText = e.target.value;
      });
    }

    if (applyBtn) {
      applyBtn.addEventListener('click', async () => {
        const b = bandSelect ? bandSelect.value : controller.params.band;
        const ms = samplesRange ? Number(samplesRange.value) : controller.params.min_samples;
        await controller.fetchAndRender({ band: b, min_samples: ms });
      });
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => controller.toggleMarkers());
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => controller.resetView());
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => controller.exportCSV());
    }

    // hide score overlay when user clicks map background
    map.on('click', (ev) => {
      // if clicked a marker the marker click handler will display score; otherwise hide
      // Leaflet fires marker click first, then map click, so add micro-delay
      setTimeout(() => {
        const popup = document.querySelector('.leaflet-popup');
        if (!popup) hideMapScore();
      }, 10);
    });

  } catch (e) {
    console.warn('Error wiring DOM controls', e);
  }

  // initial fetch
  try {
    await controller.fetchAndRender();
  } catch (e) {
    // already logged
  }

  return controller;
}

// Auto-run on module import if #map exists
(async () => {
  const mapEl = document.getElementById(MAP_ID);
  if (mapEl) {
    // small defer to ensure DOM fully parsed
    window.requestAnimationFrame(() => {
      initHeatmapPage().catch(e => console.error('initHeatmapPage failed', e));
    });
  } else {
    console.warn(`#${MAP_ID} element not found — heatmap module did not initialize.`);
  }
})();
