// /js/route.js
// Initializes Leaflet map for Safe Route page, wires controls, calls /api/safe_route,
// draws candidate routes and highlights best route.
//
// Exports nothing (auto-runs on import). If you want to call init manually,
// call window._sarthi_route_controller returned by initRoutePage().

const DEFAULT_CENTER = [12.97, 77.59];
const DEFAULT_ZOOM = 13;
const MAP_ID = 'map';

async function safeApiPost(path, body = {}) {
  try {
    const apiModule = await import('/js/api.js').then(m => m.default).catch(() => null);
    if (apiModule && typeof apiModule.post === 'function') {
      return await apiModule.post(path, body);
    }
  } catch (e) {
    console.warn('api.js import/post failed, falling back to fetch', e);
  }

  // fallback fetch
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

function parseLatLngPair(str) {
  if (!str) return null;
  const parts = String(str).split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return [lat, lng];
}

function clearLayerGroup(lg) {
  if (!lg) return;
  lg.clearLayers();
}

/**
 * Initialize the route page map and controls.
 * Returns a controller object saved on window._sarthi_route_controller
 */
export async function initRoutePage() {
  if (!document.getElementById(MAP_ID)) {
    console.error(`#${MAP_ID} not found in DOM`);
    return;
  }

  if (typeof L === 'undefined') {
    console.error('Leaflet (L) is not loaded. Ensure Leaflet script is included before /js/route.js');
    document.getElementById(MAP_ID).innerText = 'Map initialization failed (Leaflet missing). Check console.';
    return;
  }

  // reuse if already initialized
  if (window._sarthi_route_controller) {
    return window._sarthi_route_controller;
  }

  const map = L.map(MAP_ID, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const layers = {
    startMarker: null,
    endMarker: null,
    candidates: L.layerGroup().addTo(map),
    best: L.layerGroup().addTo(map),
  };

  let picking = null; // 'start'|'end'|null

  // DOM elements (may be missing if structure changed)
  const startInput = document.getElementById('startInput');
  const endInput = document.getElementById('endInput');
  const pickStartBtn = document.getElementById('pickStart');
  const pickEndBtn = document.getElementById('pickEnd');
  const routeBtn = document.getElementById('routeBtn');
  const routeInfo = document.getElementById('routeInfo') || document.getElementById('routeSummary') || null;
  const feedback = document.getElementById('routeFeedback') || null;

  function setFeedback(msg) {
    if (feedback) feedback.innerText = msg;
    else console.log('route feedback:', msg);
  }

  function setRouteInfo(html) {
    if (!routeInfo) {
      console.log('routeInfo:', html);
      return;
    }
    // if routeInfo is container element (not text), set innerHTML
    if (routeInfo.innerHTML !== undefined) routeInfo.innerHTML = html;
  }

  function addStartMarker(latlng) {
    if (layers.startMarker) map.removeLayer(layers.startMarker);
    layers.startMarker = L.marker(latlng, { title: 'Start' }).addTo(map);
  }
  function addEndMarker(latlng) {
    if (layers.endMarker) map.removeLayer(layers.endMarker);
    layers.endMarker = L.marker(latlng, { title: 'End' }).addTo(map);
  }

  function clearRoutes() {
    clearLayerGroup(layers.candidates);
    clearLayerGroup(layers.best);
  }

  async function evaluateRoutes(start, end, opts = {}) {
    setFeedback('Evaluating routes...');
    clearRoutes();

    const payload = {
      start: [start[0], start[1]],
      end: [end[0], end[1]],
      band: opts.band || (document.getElementById('bandSelect')?.value || 'night'),
      step_m: opts.step_m || 50
    };

    try {
      const res = await safeApiPost('/api/safe_route', payload);
      // expected shape: { all_evaluations: [...], best_route: [[lat,lng],...], best_eval: {...} }
      const evals = res.all_evaluations || res.evaluations || [];
      const bestRoute = res.best_route || (res.best_eval && res.best_eval.route) || null;

      // draw candidates
      evals.forEach((ev, idx) => {
        // attempt to get route points from common keys
        const pts = ev.route || ev.route_geometry || ev.coords || ev.path || ev.points;
        if (!Array.isArray(pts) || pts.length === 0) return;

        // normalize: pts may be [{lat, lng}] or [[lat,lng]]
        const latlngs = pts.map(p => (Array.isArray(p) ? [p[0], p[1]] : [p.lat ?? p[0], p.lng ?? p[1]]));
        const poly = L.polyline(latlngs, {
          className: 'route-candidate',
          weight: 5,
          opacity: 0.95,
          color: (ev.eval && ev.eval.avg_score !== undefined) ? (ev.eval.avg_score >= 0.66 ? 'var(--success)' : (ev.eval.avg_score >= 0.33 ? '#ffbf00' : 'var(--danger)')) : '#999'
        });

        poly.bindPopup(`<strong>Candidate ${idx + 1}</strong><br>Avg score: ${ev.eval?.avg_score ?? 'N/A'}<br>Coverage: ${ev.eval?.coverage ?? 'N/A'}`);
        layers.candidates.addLayer(poly);
      });

      // draw best route (prominent)
      if (bestRoute && Array.isArray(bestRoute) && bestRoute.length) {
        const bestLatLngs = bestRoute.map(p => (Array.isArray(p) ? [p[0], p[1]] : [p.lat ?? p[0], p.lng ?? p[1]]));
        const bestPoly = L.polyline(bestLatLngs, {
          className: 'route-best',
          weight: 8,
          opacity: 1,
          color: getComputedStyle(document.documentElement).getPropertyValue('--primary') || '#4ea8ff'
        });
        bestPoly.bindPopup('<strong>Best route</strong>');
        layers.best.addLayer(bestPoly);

        // fit map to best route bounds
        try {
          const bounds = L.latLngBounds(bestLatLngs);
          map.fitBounds(bounds.pad(0.1));
        } catch (e) { console.warn('fitBounds failed', e); }
        setRouteInfo(`<strong>Best route</strong><br>Score: ${res.best_eval?.avg_score ?? res.best_score ?? 'N/A'}`);
      } else {
        // if no best route, try to fit to start/end
        try {
          map.fitBounds([start, end]);
        } catch (e) { /* ignore */ }
        setRouteInfo('No best route returned');
      }

      setFeedback('Route evaluation complete.');
      return res;
    } catch (err) {
      console.error('safe_route error', err);
      setFeedback('Failed to compute routes: ' + (err.message || err));
      throw err;
    }
  }

  // map click handler (for picking start/end)
  map.on('click', (e) => {
    if (!picking) return;
    const latlng = [e.latlng.lat, e.latlng.lng];
    if (picking === 'start') {
      if (startInput) startInput.value = `${latlng[0].toFixed(6)}, ${latlng[1].toFixed(6)}`;
      addStartMarker(latlng);
    } else if (picking === 'end') {
      if (endInput) endInput.value = `${latlng[0].toFixed(6)}, ${latlng[1].toFixed(6)}`;
      addEndMarker(latlng);
    }
    // stop picking mode
    picking = null;
    // update button aria/state if present
    if (pickStartBtn) pickStartBtn.setAttribute('aria-pressed', 'false');
    if (pickEndBtn) pickEndBtn.setAttribute('aria-pressed', 'false');
  });

  // wire pick buttons
  if (pickStartBtn) {
    pickStartBtn.addEventListener('click', () => {
      picking = 'start';
      pickStartBtn.setAttribute('aria-pressed', 'true');
      setFeedback('Click on the map to pick START point.');
    });
  }
  if (pickEndBtn) {
    pickEndBtn.addEventListener('click', () => {
      picking = 'end';
      pickEndBtn.setAttribute('aria-pressed', 'true');
      setFeedback('Click on the map to pick END point.');
    });
  }

  if (routeBtn) {
    routeBtn.addEventListener('click', async () => {
      setFeedback('');
      const startStr = startInput?.value?.trim();
      const endStr = endInput?.value?.trim();
      const start = parseLatLngPair(startStr);
      const end = parseLatLngPair(endStr);
      if (!start || !end) {
        setFeedback('Invalid start or end coordinates. Use "lat, lng" format.');
        return;
      }
      // update start/end markers
      addStartMarker(start);
      addEndMarker(end);
      try {
        await evaluateRoutes(start, end, { band: document.getElementById('bandSelect')?.value });
      } catch (e) { /* already handled */ }
    });
  }

  // Populate markers from existing inputs if present
  const maybeStart = parseLatLngPair(startInput?.value);
  const maybeEnd = parseLatLngPair(endInput?.value);
  if (maybeStart) addStartMarker(maybeStart);
  if (maybeEnd) addEndMarker(maybeEnd);

  // Save controller globally so other scripts can call it
  const controller = {
    map,
    layers,
    evaluateRoutes,
    addStartMarker,
    addEndMarker,
    clearRoutes,
    setFeedback
  };

  window._sarthi_route_controller = controller;

  return controller;
}

// Auto-run
(async () => {
  const mapEl = document.getElementById(MAP_ID);
  if (mapEl) {
    try {
      await initRoutePage();
    } catch (e) {
      console.error('initRoutePage failed', e);
      document.getElementById(MAP_ID).innerText = 'Map initialization failed. See console.';
    }
  } else {
    console.warn(`#${MAP_ID} element not found — route module did not initialize.`);
  }
})();
