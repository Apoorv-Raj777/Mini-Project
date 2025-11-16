// /frontend/js/map.js
// Universal map helper module for Sarthi
// Works for:
//  - Help Others! page (audit submission)
//  - Heatmap page
//  - Safe Route page
//  - Dashboard map (includes initUserContribMap helper)
//
// Requirements:
// - Leaflet must be loaded before using these helpers:
//   <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
// - If you want heatmaps, include leaflet.heat:
//   <script src="https://unpkg.com/leaflet.heat/dist/leaflet-heat.js"></script>
//
// Exports:
// - getUserLocation()
// - initSubmitMap(containerId, onSelect)
// - initHeatmap(containerId, points)
// - initRouteMap(containerId)
// - addMarkers(mapObj, points)
// - initUserContribMap(containerId, audits)   <-- new helper for dashboard

console.log('map.js loaded');

const DEFAULT_CENTER = [13.13, 77.57]; // BMSIT, Bangalore
const DEFAULT_ZOOM = 15;

/**
 * Try to get user geolocation, fallback to DEFAULT_CENTER.
 * Resolves to [lat, lng].
 */
export function getUserLocation(timeoutMs = 5000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(DEFAULT_CENTER);
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(DEFAULT_CENTER);
      }
    }, timeoutMs);

    navigator.geolocation.getCurrentPosition(
      pos => {
        if (resolved) return;
        clearTimeout(timer);
        resolved = true;
        resolve([pos.coords.latitude, pos.coords.longitude]);
      },
      () => {
        if (resolved) return;
        clearTimeout(timer);
        resolved = true;
        resolve(DEFAULT_CENTER);
      },
      { maximumAge: 60 * 1000, timeout: timeoutMs, enableHighAccuracy: false }
    );
  });
}

// ------------------------------------------------------------
// 1) initSubmitMap  (Help Others page)
// ------------------------------------------------------------
export function initSubmitMap(containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`initSubmitMap: No container found with id: ${containerId}`);
    return null;
  }

  if (!window.L) {
    container.textContent = 'Leaflet not loaded. Please include Leaflet library.';
    return null;
  }

  const map = L.map(containerId, {
    zoomControl: true,
    attributionControl: false
  });

  // center map (async)
  getUserLocation().then(center => {
    map.setView(center, DEFAULT_ZOOM);
  }).catch(() => {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  });

  // tile layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  let marker = null;

  function setMarker(latlng) {
    if (marker) map.removeLayer(marker);
    marker = L.marker(latlng, { draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      if (onSelect) onSelect([pos.lat, pos.lng]);
    });
  }

  function clearMarker() {
    if (marker) {
      map.removeLayer(marker);
      marker = null;
    }
  }

  // click → set marker
  map.on('click', e => {
    const { lat, lng } = e.latlng;
    setMarker(e.latlng);
    if (onSelect) onSelect([lat, lng]);
  });

  return {
    map,
    setMarker,
    clearMarker,
    getMarkerLatLng: () => (marker ? marker.getLatLng() : null)
  };
}

// ------------------------------------------------------------
// 2) initHeatmap (Heatmap page)
// points format: [{lat, lng, intensity}, ...]
// ------------------------------------------------------------
export function initHeatmap(containerId, points = []) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`initHeatmap: No container with ID ${containerId}`);
    return null;
  }

  if (!window.L) {
    container.textContent = 'Leaflet not loaded. Please include Leaflet library.';
    return null;
  }

  const map = L.map(containerId, {
    zoomControl: true,
    attributionControl: false
  });

  getUserLocation().then(center => {
    map.setView(center, DEFAULT_ZOOM);
  }).catch(() => {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  const heatPoints = (points || []).map(p => [p.lat, p.lng, p.intensity || 0.5]);

  if (L.heatLayer) {
    const heat = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 15,
      maxZoom: 17
    });
    heat.addTo(map);

    return {
      map,
      heat,
      setPoints(newPoints) {
        const arr = (newPoints || []).map(p => [p.lat, p.lng, p.intensity || 0.5]);
        heat.setLatLngs(arr);
      }
    };
  } else {
    console.error('initHeatmap: Leaflet.heat plugin missing');
    container.innerHTML = '<p style="color:var(--danger)">Heatmap plugin missing</p>';
    return { map, heat: null, setPoints: () => {} };
  }
}

// ------------------------------------------------------------
// 3) initRouteMap (Safe Route page)
// ------------------------------------------------------------
export function initRouteMap(containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`initRouteMap: No container: ${containerId}`);
    return null;
  }
  if (!window.L) {
    container.textContent = 'Leaflet not loaded. Please include Leaflet library.';
    return null;
  }

  const map = L.map(containerId, { zoomControl: true, attributionControl: false });

  getUserLocation().then(center => {
    map.setView(center, DEFAULT_ZOOM);
  }).catch(() => {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  let routeLine = null;
  let startMarker = null;
  let endMarker = null;

  function setRoute(coords) {
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(coords, { weight: 5 }).addTo(map);
    try { map.fitBounds(routeLine.getBounds(), { padding: [40, 40] }); } catch (e) {}
  }

  function setStart(latlng) {
    if (startMarker) map.removeLayer(startMarker);
    startMarker = L.marker(latlng, { draggable: false }).addTo(map);
  }

  function setEnd(latlng) {
    if (endMarker) map.removeLayer(endMarker);
    endMarker = L.marker(latlng, { draggable: false }).addTo(map);
  }

  return {
    map,
    setRoute,
    setStart,
    setEnd,
    clear() {
      if (routeLine) map.removeLayer(routeLine);
      if (startMarker) map.removeLayer(startMarker);
      if (endMarker) map.removeLayer(endMarker);
      routeLine = null;
      startMarker = null;
      endMarker = null;
    }
  };
}

// ------------------------------------------------------------
// 4) addMarkers (utility)
// points = [{lat, lng, label}, ...]
// ------------------------------------------------------------
export function addMarkers(mapObj, points) {
  if (!mapObj || !mapObj.map) {
    console.warn('addMarkers: invalid map object');
    return;
  }
  (points || []).forEach(p => {
    L.marker([p.lat, p.lng])
      .addTo(mapObj.map)
      .bindPopup(p.label || 'Location');
  });
}

// ------------------------------------------------------------
// 5) initUserContribMap (Dashboard helper)
//    - creates/reuses a map inside containerId
//    - renders circle markers colored by score
//    - optionally renders a heat layer (if leaflet.heat available)
//    - returns state { map, markers, heat }
// ------------------------------------------------------------
export function initUserContribMap(containerId = 'userMap', audits = []) {
  if (typeof document === 'undefined') return null;
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`initUserContribMap: container "${containerId}" not found`);
    return null;
  }

  if (!window.L) {
    container.textContent = 'Leaflet not loaded. Please include Leaflet library.';
    return null;
  }

  // Keep map state per container to allow multiple maps on different pages
  window._sarthi_maps = window._sarthi_maps || {};
  let state = window._sarthi_maps[containerId];

  if (!state) {
    // initialize map
    const map = L.map(containerId, { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    state = {
      map,
      markers: L.layerGroup().addTo(map),
      heat: null
    };
    window._sarthi_maps[containerId] = state;

    // try to center on user location asynchronously
    getUserLocation().then(center => {
      try { state.map.setView(center, DEFAULT_ZOOM); } catch (e) {}
    }).catch(() => {});
  }

  // clear previous layers
  try { state.markers.clearLayers(); } catch (e) {}
  if (state.heat && typeof state.heat.setLatLngs === 'function') {
    try { state.heat.setLatLngs([]); } catch (e) {}
  }

  const heatPoints = [];
  const bounds = [];

  for (const a of (audits || [])) {
    const lat = (typeof a.lat === 'number') ? a.lat : (typeof a.latitude === 'number' ? a.latitude : null);
    const lng = (typeof a.lng === 'number') ? a.lng : (typeof a.longitude === 'number' ? a.longitude : null);
    if (lat === null || lng === null) continue;

    const score = (a.calculated_score !== undefined) ? a.calculated_score : (a.score !== undefined ? a.score : null);
    // normalize intensity 0.1..1.0
    let intensity = 0.6;
    if (typeof score === 'number') {
      intensity = Math.max(0.1, Math.min(1, score));
    }

    heatPoints.push([lat, lng, intensity]);
    bounds.push([lat, lng]);

    const color = (score === null) ? '#888' : (score > 0.66 ? '#20c997' : (score > 0.33 ? '#ffbf00' : '#ff6b6b'));
    const marker = L.circleMarker([lat, lng], {
      radius: 6,
      fillColor: color,
      color: '#111',
      weight: 1,
      fillOpacity: 0.95
    });

    const when = a.timestamp ? new Date(a.timestamp * 1000).toLocaleString() : (a.created_at ? new Date(a.created_at).toLocaleString() : '');
    const popup = `<div style="min-width:140px"><strong>Score:</strong> ${score ?? '—'}<br/><small>${when}</small></div>`;
    marker.bindPopup(popup);
    state.markers.addLayer(marker);
  }

  // heat layer (if plugin available)
  if (L.heatLayer && heatPoints.length) {
    if (!state.heat) {
      try {
        state.heat = L.heatLayer(heatPoints, { radius: 25, blur: 18, maxZoom: 17, max: 1.0 }).addTo(state.map);
      } catch (e) {
        console.warn('initUserContribMap: failed to create heat layer', e);
      }
    } else {
      try { state.heat.setLatLngs(heatPoints); } catch (e) {}
    }
  }

  // fit bounds to points
  if (bounds.length) {
    try {
      state.map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
    } catch (e) {
      // ignore fit errors
    }
  } else {
    // if no points, keep current view or recentre to default
    // state.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  }

  return state;
}

// Export default (compat)
export default {
  getUserLocation,
  initSubmitMap,
  initHeatmap,
  initRouteMap,
  addMarkers,
  initUserContribMap
};
