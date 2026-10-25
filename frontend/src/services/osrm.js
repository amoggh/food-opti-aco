// Client-side OpenStreetMap (OSRM) Road Routing with LocalStorage/Memory Cache
const memoryCache = new Map();

/**
 * Fetches real turn-by-turn physical street geometry for a sequence of coordinates.
 * @param {Array<[number, number]>} waypoints - Array of [lat, lon] coordinates
 * @returns {Promise<Array<[number, number]>>} - Array of [lat, lon] road waypoints
 */
export async function getStreetRoute(waypoints) {
  if (!waypoints || waypoints.length < 2) return [];

  const key = waypoints.map(p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';');
  if (memoryCache.has(key)) {
    return memoryCache.get(key);
  }

  // Try localStorage cache
  try {
    const cached = sessionStorage.getItem(`osrm_${key}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      memoryCache.set(key, parsed);
      return parsed;
    }
  } catch (e) {
    // ignore storage error
  }

  // Format: lon,lat;lon,lat;...
  const coordsStr = waypoints.map(p => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        // OSRM returns [lon, lat], convert to [lat, lon]
        const roadCoords = data.routes[0].geometry.coordinates.map(pt => [pt[1], pt[0]]);
        memoryCache.set(key, roadCoords);
        try {
          sessionStorage.setItem(`osrm_${key}`, JSON.stringify(roadCoords));
        } catch (e) {
          // ignore storage quota error
        }
        return roadCoords;
      }
    }
  } catch (e) {
    console.debug('OSRM client routing fallback:', e);
  }

  // Fallback: Manhattan orthogonal street routing (avoids diagonal straight lines across city blocks)
  const fallback = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    fallback.push(p1);
    fallback.push([p2[0], p1[1]]); // orthogonal corner turn
  }
  fallback.push(waypoints[waypoints.length - 1]);
  return fallback;
}
