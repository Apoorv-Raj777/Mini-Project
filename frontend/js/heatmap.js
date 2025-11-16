// /js/heatmap.js
// Initializes Leaflet map in #map, fetches heatmap points from backend
// and draws circleMarkers colored by safety score.

import api from './api.js';

const DEFAULT_CENTER = [13.13, 77.57];
const DEFAULT_ZOOM = 16;
const MAP_ID = 'map';

// Utility: color by score 0..1
function scoreToColor(score) {
  const s = Math.max(0, Math.min(1, Number(score) || 0));
  const r = Math.round(Math.min(255, Math.max(0, 255 * (1 - s) * 1.6)));
  const g = Math.round(Math.min(255, Math.max(0, 255 * s * 1.2)));
  const b = 40;
  return `rgb(${r},${g},${b})`;
}

// Utility: format score as percentage with 2 decimals (Option E)
function scoreToPercentStr(score) {
  if (score === undefined || score === null || Number.isNaN(Number(score))) return '—';
  return `${(Number(score) * 100).toFixed(2)}%`;
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
  return await api.get(path, { params });
}

function showMapScore(point) {
  const scoreEl = document.getElementById('scoreValue');
  const samplesEl = document.getElementById('scoreSamples');
  const mapScore = document.getElementById('mapScore');
  if (!mapScore) return;
  scoreEl && (scoreEl.innerText = (point.score !== undefined && point.score !== null) ? scoreToPercentStr(point.score) : '—');
  samplesEl && (samplesEl.innerText = `samples: ${point.samples ?? '—'}`);
  mapScore.style.display = 'block';
  mapScore.setAttribute('aria-hidden', 'false');
}

function hideMapScore() {
  const mapScore = document.getElementById('mapScore');
  if (!mapScore) return;
  mapScore.style.display = 'none';
  mapScore.setAttribute('aria-hidden', 'true');
}

function updateLeftFeedback(pts) {
  // Shows "X points loaded. Avg score: 72.34%"
  const feedbackEl = document.getElementById('formFeedback');
  if (!feedbackEl) return;
  const n = (pts && pts.length) || 0;
  let avg = null;
  if (n > 0) {
    const valid = pts.filter(p => p.score !== undefined && p.score !== null && !Number.isNaN(Number(p.score)));
    if (valid.length > 0) {
      const s = valid.reduce((acc, p) => acc + Number(p.score || 0), 0) / valid.length;
      avg = Number(s);
    }
  }
  feedbackEl.innerText = avg === null ? `${n} points loaded.` : `${n} points loaded. Avg score: ${scoreToPercentStr(avg)}`;
}

// All API requests use api.js!
export async function initHeatmapPage({ band = 'night', min_samples = 1 } = {}) {
  if (!document.getElementById(MAP_ID)) {
    console.error(`#${MAP_ID} element not found in DOM`);
    return;
  }

  if (typeof L === 'undefined') {
    console.error('Leaflet (L) is not loaded. Make sure you included Leaflet JS before this module.');
    document.getElementById(MAP_ID).innerText = 'Map initialization failed (Leaflet missing). Check console.';
    return;
  }

  // Use singleton map if already present
  if (window._sarthi_heatmap_map) {
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

  const markersLayer = L.layerGroup().addTo(map);
  let lastFetchedPoints = [];

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
        const data = await safeApiGet('/heatmap_data', { band: params.band, min_samples: params.min_samples, bbox });
        const pts = Array.isArray(data) ? data : (data.points || data.data || []);
        lastFetchedPoints = pts;
        controller.lastFetchedPoints = pts;

        markersLayer.clearLayers();
        hideMapScore();

        // update left feedback with avg score
        updateLeftFeedback(pts);

        pts.forEach(p => {
          if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;

          // compute radius:
          // base radius + influence from samples and score
          const samples = Math.max(1, Number(p.samples || 1));
          const score = (p.score !== undefined && p.score !== null) ? Number(p.score) : null;

          // Base radius is larger so points are visible
          let radius = 8 + Math.min(30, samples * 2);
          if (score !== null) {
            radius += Math.round((score - 0.5) * 6); // -3..+3
          }
          radius = Math.max(6, Math.min(40, radius));

          const color = scoreToColor(score ?? 0.5);

          const marker = L.circleMarker([p.lat, p.lng], {
            radius,
            fillColor: color,
            color: 'rgba(255,255,255,0.06)',
            weight: 1,
            fillOpacity: 0.95
          });

          const scoreTextPct = scoreToPercentStr(p.score);
          const samplesText = p.samples ?? '—';
          const confText = p.confidence ?? p.confidence_numeric ?? '—';

          const popupHtml = `<div style="min-width:160px">
            <div style="margin-bottom:6px"><strong>Safety:</strong> <span style="color:${color};font-weight:700">${scoreTextPct}</span></div>
            <div><strong>Samples:</strong> ${samplesText}</div>
            <div><strong>Confidence:</strong> ${confText}</div>
          </div>`;

          marker.bindPopup(popupHtml, { maxWidth: 260, closeButton: true });

          marker.on('click', () => {
            showMapScore({ score: score, samples });
          });

          markersLayer.addLayer(marker);
        });

        // Ensure left feedback shows avg in percent after drawing
        updateLeftFeedback(pts);

        return pts;
      } catch (err) {
        console.error('Failed to fetch heatmap data', err);
        if (feedback) feedback.innerText = `Failed to load data: ${err.message || err}`;
        throw err;
      }
    },

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

    map.on('click', (ev) => {
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
    window.requestAnimationFrame(() => {
      initHeatmapPage().catch(e => console.error('initHeatmapPage failed', e));
    });
  } else {
    console.warn(`#${MAP_ID} element not found — heatmap module did not initialize.`);
  }
})();
