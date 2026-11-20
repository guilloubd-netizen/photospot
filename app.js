/**
 * PhotoSpot & Settings — PWA Mobile Photo Assistant
 * Architecture sans dépendance : LocalStorage, Geolocation, Open-Meteo, Nominatim, Gemini/Overpass
 */

// ==========================================
// 1. CONFIGURATION & ÉTAT GLOBAL
// ==========================================
const STORAGE_GEAR_KEY = 'photospot_gear_v1';
const STORAGE_AI_KEY = 'photospot_ai_v1';

const DEFAULT_GEAR = {
  bodies: [
    { id: 'b1', name: 'Sony A7 IV', sensor: 'fullframe' },
    { id: 'b2', name: 'Fujifilm X-T5', sensor: 'apsc' }
  ],
  lenses: [
    { id: 'l1', name: '24-70mm f/2.8 GM II', focalMin: 24, focalMax: 70, maxAperture: 2.8 },
    { id: 'l2', name: '50mm f/1.8', focalMin: 50, focalMax: 50, maxAperture: 1.8 },
    { id: 'l3', name: '70-200mm f/2.8', focalMin: 70, focalMax: 200, maxAperture: 2.8 },
    { id: 'l4', name: '16-35mm f/4', focalMin: 16, focalMax: 35, maxAperture: 4.0 }
  ],
  selectedBodyId: 'b1',
  selectedLensId: 'l1',
  selectedFocal: 35
};

const SENSOR_SPECS = {
  fullframe: { label: 'Plein Format (24×36)', short: 'FF', crop: 1.0, baseIso: 100, maxCleanIso: 6400 },
  apsc:      { label: 'APS-C', short: 'APS-C', crop: 1.5, baseIso: 160, maxCleanIso: 3200 },
  mft:       { label: 'Micro 4/3', short: 'M4/3', crop: 2.0, baseIso: 200, maxCleanIso: 1600 }
};

let state = {
  activeTab: 'spots',
  activeScene: 'landscape',
  gear: loadGear(),
  aiConfig: loadAIConfig(),
  location: null, // { lat, lon, city, area, country }
  weather: null,  // Données Open-Meteo + calculs solaires
  spots: []
};

// ==========================================
// 2. INITIALISATION & SERVICE WORKER
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  registerSW();
  bindUIEvents();
  renderQuickSelectors();
  renderGearEditor();
  loadAIConfigIntoUI();
  updateFocalSliderVisibility();
  updateSettingsAssistant();
  requestLocationAndRefresh();
});

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function loadGear() {
  try {
    const raw = localStorage.getItem(STORAGE_GEAR_KEY);
    if (!raw) return structuredClone(DEFAULT_GEAR);
    const parsed = JSON.parse(raw);
    if (!parsed.bodies || !parsed.lenses) return structuredClone(DEFAULT_GEAR);
    return parsed;
  } catch {
    return structuredClone(DEFAULT_GEAR);
  }
}

function saveGear() {
  localStorage.setItem(STORAGE_GEAR_KEY, JSON.stringify(state.gear));
}

function loadAIConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_AI_KEY)) || { apiKey: '', model: 'gemini-3.5-flash' };
  } catch {
    return { apiKey: '', model: 'gemini-3.5-flash' };
  }
}

// ==========================================
// 3. ÉVÉNEMENTS UI & NAVIGATION
// ==========================================
function bindUIEvents() {
  // Onglets bas
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Bouton actualisation GPS
  document.getElementById('btn-refresh-gps').addEventListener('click', requestLocationAndRefresh);
  document.getElementById('btn-retry-gps').addEventListener('click', requestLocationAndRefresh);
  document.getElementById('btn-demo-location').addEventListener('click', () => {
    hideGpsError();
    handleCoordinates(48.8566, 2.3522, true);
  });

  document.getElementById('btn-regen-spots').addEventListener('click', () => {
    if (state.location && state.weather) generatePhotoSpots();
  });

  // Couple rapide Boîtier / Objectif
  document.getElementById('quick-body-select').addEventListener('change', (e) => {
    state.gear.selectedBodyId = e.target.value;
    saveGear();
    updateSettingsAssistant();
  });

  document.getElementById('quick-lens-select').addEventListener('change', (e) => {
    state.gear.selectedLensId = e.target.value;
    const lens = getActiveLens();
    state.gear.selectedFocal = Math.round((lens.focalMin + lens.focalMax) / 2);
    saveGear();
    updateFocalSliderVisibility();
    updateSettingsAssistant();
  });

  // Scènes dans l'onglet Réglages
  document.querySelectorAll('.scene-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeScene = btn.dataset.scene;
      document.querySelectorAll('.scene-btn').forEach((b) => b.classList.remove('active-scene'));
      btn.classList.add('active-scene');
      refreshSceneButtonStyles();
      updateSettingsAssistant();
    });
  });
  refreshSceneButtonStyles();

  // Slider focale zoom
  document.getElementById('focal-slider').addEventListener('input', (e) => {
    state.gear.selectedFocal = Number(e.target.value);
    document.getElementById('focal-slider-val').textContent = `${state.gear.selectedFocal} mm`;
    saveGear();
    updateSettingsAssistant();
  });

  // Sauvegarde config IA
  document.getElementById('btn-save-ai').addEventListener('click', () => {
    state.aiConfig = {
      apiKey: document.getElementById('gemini-api-key').value.trim(),
      model: document.getElementById('gemini-model').value
    };
    localStorage.setItem(STORAGE_AI_KEY, JSON.stringify(state.aiConfig));
    showToast('Configuration Gemini enregistrée');
    if (state.location && state.weather) generatePhotoSpots();
  });

  // Réinitialisation matériel
  document.getElementById('btn-reset-gear').addEventListener('click', () => {
    state.gear = structuredClone(DEFAULT_GEAR);
    saveGear();
    renderQuickSelectors();
    renderGearEditor();
    updateFocalSliderVisibility();
    updateSettingsAssistant();
    showToast('Matériel réinitialisé');
  });
}

function switchTab(tabName) {
  state.activeTab = tabName;
  ['spots', 'settings', 'gear'].forEach((t) => {
    document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tabName);
  });
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('text-amber-400', active);
    btn.classList.toggle('text-zinc-400', !active);
  });
}

function refreshSceneButtonStyles() {
  document.querySelectorAll('.scene-btn').forEach((btn) => {
    const isActive = btn.dataset.scene === state.activeScene;
    btn.className = isActive
      ? 'scene-btn active-scene py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition bg-amber-500/15 border-amber-500 text-amber-400'
      : 'scene-btn py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition bg-surface border-white/10 text-zinc-300';
  });
}

// ==========================================
// 4. GÉOLOCALISATION GPS (Gestion stricte iOS)
// ==========================================
function requestLocationAndRefresh() {
  setRefreshLoading(true);
  hideGpsError();

  if (!window.isSecureContext) {
    setRefreshLoading(false);
    showGpsError(
      'Connexion HTTPS requise sur iPhone',
      'Safari iOS bloque le GPS sur les pages HTTP non sécurisées. Déployez cette PWA en HTTPS (GitHub Pages, Netlify ou Vercel) pour activer la géolocalisation.'
    );
    return;
  }

  if (!('geolocation' in navigator)) {
    setRefreshLoading(false);
    showGpsError(
      'GPS non supporté',
      'Votre navigateur ne prend pas en charge la géolocalisation.'
    );
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      handleCoordinates(pos.coords.latitude, pos.coords.longitude, false);
    },
    (err) => {
      setRefreshLoading(false);
      let title = 'Accès GPS impossible';
      let msg = 'Impossible de récupérer votre position actuelle.';

      if (err.code === err.PERMISSION_DENIED) {
        title = 'Permission GPS refusée sur iOS';
        msg = 'Allez dans Réglages iPhone > Confidentialité et sécurité > Service de localisation > Sites web Safari, et sélectionnez "Lorsque l\'app est active".';
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        title = 'Signal GPS indisponible';
        msg = 'Vérifiez que le Service de localisation est activé sur votre iPhone et que vous avez une connexion réseau.';
      } else if (err.code === err.TIMEOUT) {
        title = 'Délai GPS expiré';
        msg = 'La recherche satellite a pris trop de temps. Déplacez-vous près d\'une fenêtre ou en extérieur et réessayez.';
      }
      showGpsError(title, msg);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

async function handleCoordinates(lat, lon, isDemo) {
  try {
    const [geoInfo, weatherInfo] = await Promise.all([
      reverseGeocode(lat, lon),
      fetchOpenMeteo(lat, lon)
    ]);

    state.location = { lat, lon, ...geoInfo, isDemo };
    state.weather = weatherInfo;

    const demoTag = isDemo ? ' (Démo)' : '';
    document.getElementById('header-location').textContent =
      `${geoInfo.city}${geoInfo.area ? ' • ' + geoInfo.area : ''}${demoTag}`;

    renderWeatherCard();
    updateSettingsAssistant();
    await generatePhotoSpots();
  } catch (err) {
    showToast('Erreur de synchronisation météo/réseau');
    console.error(err);
  } finally {
    setRefreshLoading(false);
  }
}

// ==========================================
// 5. OPEN-METEO & ASTRONOMIE SOLAIRE
// ==========================================
async function fetchOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m` +
    `&hourly=uv_index&daily=sunrise,sunset,uv_index_max&timezone=auto&forecast_days=1`;

  const res = await fetch(url);
  if (!res.ok) throw new Error('Erreur Open-Meteo');
  const data = await res.json();

  // Indice UV correspondant à l'heure courante
  const currentHourStr = data.current.time.slice(0, 13);
  const hourIdx = data.hourly.time.findIndex((t) => t.startsWith(currentHourStr));
  const currentUv = hourIdx >= 0 ? data.hourly.uv_index[hourIdx] : (data.daily.uv_index_max[0] || 0);

  const sunriseStr = data.daily.sunrise[0]; // format "YYYY-MM-DDTHH:MM"
  const sunsetStr = data.daily.sunset[0];

  const sunPos = calculateSunPosition(new Date(), lat, lon);

  return {
    temp: Math.round(data.current.temperature_2m),
    clouds: data.current.cloud_cover,
    wind: Math.round(data.current.wind_speed_10m),
    gusts: Math.round(data.current.wind_gusts_10m),
    uv: Math.round(currentUv * 10) / 10,
    isDay: data.current.is_day === 1,
    code: data.current.weather_code,
    precipitation: data.current.precipitation,
    sunrise: formatTimeOnly(sunriseStr),
    sunset: formatTimeOnly(sunsetStr),
    goldenMorningEnd: addMinutesToIsoTime(sunriseStr, 50),
    blueMorningStart: addMinutesToIsoTime(sunriseStr, -35),
    goldenEveningStart: addMinutesToIsoTime(sunsetStr, -50),
    blueEveningEnd: addMinutesToIsoTime(sunsetStr, 35),
    sun: sunPos
  };
}

function renderWeatherCard() {
  const w = state.weather;
  if (!w) return;

  const wmo = interpretWmoCode(w.code, w.isDay);
  document.getElementById('weather-temp').textContent = `${w.temp}°C`;
  document.getElementById('weather-desc').textContent = wmo.label;
  document.getElementById('weather-icon').textContent = wmo.icon;
  document.getElementById('weather-clouds').textContent = `${w.clouds}%`;
  document.getElementById('weather-wind').textContent = `${w.wind} km/h`;
  document.getElementById('weather-uv').textContent = `${w.uv}`;

  document.getElementById('sun-position').textContent =
    `Azimut ${w.sun.azimuth}° (${w.sun.compass}) • Élév. ${w.sun.elevation}°`;

  document.getElementById('sun-morning').textContent = `${w.sunrise} → ${w.goldenMorningEnd}`;
  document.getElementById('blue-morning').textContent = `Blue Hour : ${w.blueMorningStart} → ${w.sunrise}`;

  document.getElementById('sun-evening').textContent = `${w.goldenEveningStart} → ${w.sunset}`;
  document.getElementById('blue-evening').textContent = `Blue Hour : ${w.sunset} → ${w.blueEveningEnd}`;
}

// Calcul astronomique NOAA simplifié de la position du soleil
function calculateSunPosition(date, lat, lon) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  const dayOfYear = Math.floor(diff / 86400000);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;

  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcHours - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  const timeOffset = eqTime + 4 * lon;
  const tst = utcHours * 60 + timeOffset;
  const ha = ((tst / 4) - 180) * rad;

  const latRad = lat * rad;
  const sinElev = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(ha);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElev))) * deg;

  const cosAz = (Math.sin(decl) - Math.sin(latRad) * sinElev) / (Math.cos(latRad) * Math.cos(elevation * rad));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * deg;
  if (Math.sin(ha) > 0) azimuth = 360 - azimuth;

  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const compass = dirs[Math.round(azimuth / 45) % 8];

  return {
    azimuth: Math.round(azimuth),
    elevation: Math.round(elevation),
    compass
  };
}

// ==========================================
// 6. GÉOCODAGE INVERSÉ & SPOTS PHOTO (GEMINI / OVERPASS)
// ==========================================
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=fr`;
    const res = await fetch(url);
    const data = await res.json();
    const addr = data.address || {};
    const city = addr.city || addr.town || addr.village || addr.municipality || 'Position GPS';
    const area = addr.suburb || addr.neighbourhood || addr.county || '';
    return { city, area, country: addr.country || '' };
  } catch {
    return { city: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, area: '', country: '' };
  }
}

async function generatePhotoSpots() {
  const listEl = document.getElementById('spots-list');
  const badgeEl = document.getElementById('spots-source-badge');
  listEl.innerHTML = `
    <div class="rounded-2xl bg-surface border border-white/10 p-6 text-center text-xs text-zinc-400">
      Recherche des meilleurs spots autour de ${escapeHtml(state.location.city)}...
    </div>`;

  // 1. Si l'utilisateur a configuré une clé Gemini, on l'utilise en priorité
  if (state.aiConfig.apiKey) {
    try {
      const spots = await fetchSpotsFromGemini();
      badgeEl.textContent = `Générés par ${state.aiConfig.model} • Soleil ${state.weather.sun.compass}`;
      renderSpots(spots);
      return;
    } catch (e) {
      console.warn('Fallback Overpass suite erreur Gemini:', e);
    }
  }

  // 2. Sinon (ou en fallback), interrogation gratuite d'OpenStreetMap Overpass API
  try {
    const spots = await fetchSpotsFromOverpass();
    badgeEl.textContent = `Données réelles OpenStreetMap • Soleil ${state.weather.sun.compass}`;
    renderSpots(spots);
  } catch {
    badgeEl.textContent = `Suggestions locales contextuelles • ${state.location.city}`;
    renderSpots(getContextualFallbackSpots());
  }
}

async function fetchSpotsFromGemini() {
  const { lat, lon, city, area } = state.location;
  const w = state.weather;
  const prompt = `Tu es un photographe professionnel local. L'utilisateur se trouve aux coordonnées GPS (${lat.toFixed(5)}, ${lon.toFixed(5)}), à ${city} (${area}).
Météo actuelle : ${w.temp}°C, couverture nuageuse ${w.clouds}%, vent ${w.wind} km/h.
Soleil actuel : Azimut ${w.sun.azimuth}° (${w.sun.compass}), élévation ${w.sun.elevation}°.
Golden Hour soir : ${w.goldenEveningStart}-${w.sunset}. Blue Hour : ${w.sunset}-${w.blueEveningEnd}.

Suggère exactement 5 spots photo réels et pertinents autour de cette position (mélange de points de vue, architecture, nature, street photo, plans d'eau).
Réponds UNIQUEMENT en JSON valide (sans markdown) sous la forme d'un tableau d'objets avec exactement ces clés :
[{"name":"Nom réel du lieu","type":"Architecture|Point de vue|Nature|Street Photo|Plan d'eau","distance":"ex: 650 m","bestTime":"Meilleur moment selon la lumière actuelle","tip":"Conseil de cadrage et orientation par rapport au soleil"}]`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${state.aiConfig.model}:generateContent`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': state.aiConfig.apiKey
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!res.ok) throw new Error('Gemini HTTP ' + res.status);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Format Gemini invalide');
  return parsed.slice(0, 5);
}

async function fetchSpotsFromOverpass() {
  const { lat, lon } = state.location;
  const query = `[out:json][timeout:8];
    (
      node(around:3000,${lat},${lon})["tourism"~"viewpoint|attraction"];
      node(around:2500,${lat},${lon})["historic"~"monument|castle|memorial"];
      way(around:2500,${lat},${lon})["leisure"="park"]["name"];
      way(around:3000,${lat},${lon})["natural"="water"]["name"];
    );
    out center 15;`;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query)
  });
  if (!res.ok) throw new Error('Overpass error');
  const data = await res.json();

  const seen = new Set();
  const mapped = [];

  for (const el of data.elements || []) {
    const name = el.tags?.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const elLat = el.lat || el.center?.lat;
    const elLon = el.lon || el.center?.lon;
    const distM = haversineMeters(lat, lon, elLat, elLon);
    const bearing = getBearingCompass(lat, lon, elLat, elLon);

    let type = 'Architecture';
    if (el.tags.tourism === 'viewpoint') type = 'Point de vue';
    else if (el.tags.leisure === 'park') type = 'Nature';
    else if (el.tags.natural === 'water') type = 'Plan d\'eau';

    const w = state.weather;
    const isAfternoon = w.sun.azimuth > 180;
    const bestTime = type === 'Plan d\'eau' || type === 'Point de vue'
      ? `Golden Hour (${w.goldenEveningStart} – ${w.sunset})`
      : isAfternoon ? `Fin d'après-midi (lumière rasante ${w.sun.compass})` : `Matin (${w.sunrise} – ${w.goldenMorningEnd})`;

    mapped.push({
      name,
      type,
      distance: distM < 1000 ? `${Math.round(distM)} m` : `${(distM / 1000).toFixed(1)} km`,
      distRaw: distM,
      bestTime,
      tip: `Situé au ${bearing} de votre position. Avec le soleil au ${w.sun.compass} (${w.sun.elevation}°), privilégiez un angle latéral pour sculpter les textures.`
    });
  }

  mapped.sort((a, b) => a.distRaw - b.distRaw);
  const top = mapped.slice(0, 5);
  return top.length >= 3 ? top : [...top, ...getContextualFallbackSpots()].slice(0, 5);
}

function getContextualFallbackSpots() {
  const city = state.location?.city || 'votre secteur';
  const w = state.weather;
  return [
    {
      name: `Centre historique de ${city}`,
      type: 'Architecture',
      distance: '~500 m',
      bestTime: `Golden Hour (${w.goldenEveningStart})`,
      tip: `Cherchez les ruelles orientées face au soleil (${w.sun.compass}) pour capturer des contre-jours et ombres longues.`
    },
    {
      name: `Quartier commerçant & places de ${city}`,
      type: 'Street Photo',
      distance: '~700 m',
      bestTime: `Maintenant ou Blue Hour (${w.sunset})`,
      tip: 'Exploitez les zones d\'ombre tranchées et les vitrines lumineuses dès la tombée du jour.'
    },
    {
      name: `Parc urbain / Espace vert le plus proche`,
      type: 'Nature',
      distance: '~1.2 km',
      bestTime: `Matin (${w.sunrise}) ou fin de journée`,
      tip: w.clouds > 60 ? 'Le ciel couvert agit comme une boîte à lumière géante, idéal pour les détails végétaux.' : 'Placez le soleil en rétro-éclairage dans le feuillage.'
    },
    {
      name: `Point haut ou belvédère sur ${city}`,
      type: 'Point de vue',
      distance: '~2.0 km',
      bestTime: `Coucher du soleil (${w.sunset})`,
      tip: `Vérifiez l'horizon vers le ${w.sun.compass} pour cadrer la silhouette urbaine.`
    }
  ];
}

function renderSpots(spots) {
  const listEl = document.getElementById('spots-list');
  const typeColors = {
    'Point de vue': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    'Architecture': 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    'Nature': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    'Street Photo': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    "Plan d'eau": 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
  };

  listEl.innerHTML = spots.map((s) => {
    const badgeCls = typeColors[s.type] || 'bg-zinc-800 text-zinc-300 border-white/10';
    return `
      <article class="rounded-2xl bg-surface border border-white/10 p-4 space-y-2.5">
        <div class="flex items-start justify-between gap-2">
          <div class="space-y-1 min-w-0">
            <span class="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeCls}">
              ${escapeHtml(s.type)}
            </span>
            <h3 class="text-sm font-semibold text-white leading-snug">${escapeHtml(s.name)}</h3>
          </div>
          <span class="shrink-0 text-xs font-mono text-zinc-300 bg-surfaceElevated px-2.5 py-1 rounded-lg border border-white/5 tabular-nums">
            ${escapeHtml(s.distance)}
          </span>
        </div>
        <div class="text-xs text-amber-300/95 flex items-center gap-1.5">
          <span>🕒</span>
          <span>${escapeHtml(s.bestTime)}</span>
        </div>
        <p class="text-xs text-zinc-400 leading-relaxed">${escapeHtml(s.tip)}</p>
      </article>
    `;
  }).join('');
}

// ==========================================
// 7. ASSISTANT DE RÉGLAGES PHOTO INTELLIGENTS
// ==========================================
function getActiveBody() {
  return state.gear.bodies.find((b) => b.id === state.gear.selectedBodyId) || state.gear.bodies[0];
}

function getActiveLens() {
  return state.gear.lenses.find((l) => l.id === state.gear.selectedLensId) || state.gear.lenses[0];
}

function updateFocalSliderVisibility() {
  const lens = getActiveLens();
  const container = document.getElementById('zoom-focal-control');
  const slider = document.getElementById('focal-slider');
  const valEl = document.getElementById('focal-slider-val');

  if (lens.focalMax > lens.focalMin) {
    container.classList.remove('hidden');
    slider.min = lens.focalMin;
    slider.max = lens.focalMax;
    const clamped = Math.min(lens.focalMax, Math.max(lens.focalMin, state.gear.selectedFocal || lens.focalMin));
    state.gear.selectedFocal = clamped;
    slider.value = clamped;
    valEl.textContent = `${clamped} mm`;
  } else {
    container.classList.add('hidden');
    state.gear.selectedFocal = lens.focalMin;
  }
}

function updateSettingsAssistant() {
  const body = getActiveBody();
  const lens = getActiveLens();
  const sensor = SENSOR_SPECS[body.sensor] || SENSOR_SPECS.fullframe;
  const focal = lens.focalMax > lens.focalMin ? state.gear.selectedFocal : lens.focalMin;
  const effectiveFocal = Math.round(focal * sensor.crop);

  // Valeurs météo par défaut si GPS pas encore chargé
  const w = state.weather || {
    clouds: 30, wind: 10, uv: 3, code: 1, isDay: true,
    sun: { elevation: 25, azimuth: 180, compass: 'S' }
  };

  // 1. Calcul EV100 ambiant réaliste
  let ev100 = 13.5;
  const elev = w.sun.elevation;
  if (elev > 30) ev100 = 14.8;
  else if (elev > 12) ev100 = 13.5;
  else if (elev > 2) ev100 = 11.2; // Golden hour
  else if (elev > -6) ev100 = 7.0; // Blue hour
  else ev100 = 2.0; // Nuit

  // Atténuation nuages et météo
  if (w.clouds > 80) ev100 -= 1.8;
  else if (w.clouds > 50) ev100 -= 1.0;
  if (w.code >= 51) ev100 -= 1.0; // Pluie / brouillard

  // 2. Règle de vitesse minimale anti-flou (en tenant compte du capteur et du vent)
  const windFactor = w.wind > 25 ? 1.5 : 1.0;
  const minHandheldShutter = 1 / Math.max(60, Math.round(effectiveFocal * windFactor));

  let aperture = lens.maxAperture;
  let iso = sensor.baseIso;
  let shutterSec = 1 / 125;
  let apertureSub = '';
  let shutterSub = '';
  let isoSub = `${sensor.short} • Base optimale`;
  const tips = [];

  // 3. Logique selon la scène
  if (state.activeScene === 'landscape') {
    aperture = Math.max(lens.maxAperture, ev100 > 13 ? 9.0 : 8.0);
    if (aperture > 11) aperture = 11;
    apertureSub = 'Piqué optimal & PDC étendue';

    shutterSec = (aperture * aperture) / (Math.pow(2, ev100) * (iso / 100));
    if (shutterSec > minHandheldShutter) {
      // Monter un peu l'ISO si possible à main levée, sinon conseiller le trépied
      const neededIso = iso * (shutterSec / minHandheldShutter);
      if (neededIso <= sensor.maxCleanIso / 2) {
        iso = snapIso(neededIso);
        shutterSec = minHandheldShutter;
        isoSub = 'Ajusté pour main levée';
        shutterSub = `Sécurisé (éq. ${effectiveFocal}mm)`;
      } else {
        shutterSub = 'Trépied requis (pose lente)';
        tips.push(`Vitesse lente (${formatShutter(shutterSec)}) : utilisez un trépied et le retardateur 2s.`);
      }
    } else {
      shutterSub = 'Main levée sans flou';
    }
  } else if (state.activeScene === 'portrait') {
    aperture = lens.maxAperture <= 2.0 ? 2.0 : lens.maxAperture;
    apertureSub = aperture <= 2.8 ? 'Bokeh crémeux (mise au point œil)' : 'Ouverture maximale de l\'optique';

    shutterSec = (aperture * aperture) / (Math.pow(2, ev100) * (iso / 100));
    const minPortraitShutter = Math.min(minHandheldShutter, 1 / 160);
    if (shutterSec > minPortraitShutter) {
      iso = snapIso(Math.min(sensor.maxCleanIso, iso * (shutterSec / minPortraitShutter)));
      shutterSec = (aperture * aperture) / (Math.pow(2, ev100) * (iso / 100));
      isoSub = 'Compense le manque de lumière';
    }
    if (shutterSec < 1 / 8000) {
      tips.push('Très forte luminosité à grande ouverture : activez l\'obturateur électronique ou vissez un filtre ND8 (sinon fermez à f/4).');
    }
    shutterSub = 'Netteté sujet & œil';
  } else if (state.activeScene === 'street') {
    aperture = ev100 >= 12 ? Math.max(lens.maxAperture, 4.0) : lens.maxAperture;
    apertureSub = aperture >= 4 ? 'Zone de netteté confortable' : 'Priorité à la lumière';

    const targetStreetShutter = w.wind > 20 ? 1 / 640 : 1 / 500;
    shutterSec = (aperture * aperture) / (Math.pow(2, ev100) * (iso / 100));
    if (shutterSec > targetStreetShutter) {
      const targetIso = iso * (shutterSec / targetStreetShutter);
      iso = snapIso(Math.min(sensor.maxCleanIso, targetIso));
      shutterSec = (aperture * aperture) / (Math.pow(2, ev100) * (iso / 100));
      isoSub = `Auto-ISO plafonné (${sensor.short})`;
    }
    shutterSub = 'Fige le mouvement des passants';
  } else if (state.activeScene === 'long_exposure') {
    aperture = Math.max(lens.maxAperture, 8.0);
    apertureSub = 'Netteté homogène bords à bords';
    iso = sensor.baseIso;
    isoSub = 'Bruit minimal sur pose longue';

    const naturalShutter = (aperture * aperture) / (Math.pow(2, ev100) * (iso / 100));
    // Vise une pose entre 4s et 15s
    if (naturalShutter < 2.0) {
      const stopsNeeded = Math.ceil(Math.log2(6.0 / naturalShutter));
      const ndFactor = Math.pow(2, stopsNeeded);
      const ndLabel = stopsNeeded >= 9 ? 'ND1000 (10 stops)' : stopsNeeded >= 6 ? 'ND64 (6 stops)' : 'ND8 (3 stops)';
      shutterSec = naturalShutter * (stopsNeeded >= 9 ? 1024 : stopsNeeded >= 6 ? 64 : 8);
      shutterSub = `Avec filtre ${ndLabel}`;
      tips.push(`Lumière ambiante élevée : montez un filtre <strong>${ndLabel}</strong> pour obtenir ~${formatShutter(shutterSec)} sur trépied.`);
    } else {
      shutterSec = Math.min(30, naturalShutter);
      shutterSub = 'Sans filtre ND (lumière faible)';
    }
    tips.push('Désactivez la stabilisation capteur/objectif (IBIS/OSS) une fois l\'appareil fixé sur trépied.');
  }

  // 4. Balance des blancs en Kelvin
  let wbKelvin = 5400;
  let wbLabel = 'Lumière du jour';
  if (elev <= 4 && elev > -3) {
    wbKelvin = 5800;
    wbLabel = 'Golden Hour (préserve l\'or)';
  } else if (elev <= -3 && elev >= -8) {
    wbKelvin = 4200;
    wbLabel = 'Blue Hour (bleus profonds)';
  } else if (elev < -8) {
    wbKelvin = 3800;
    wbLabel = 'Nuit (neutralise l\'éclairage)';
  } else if (w.clouds > 65) {
    wbKelvin = 6500;
    wbLabel = 'Nuageux (réchauffe la scène)';
  }

  // 5. Conseils contextuels météo & optique
  if (w.wind >= 25) {
    tips.push(`Vent soutenu (${w.wind} km/h) : risque de flou de bougé. Leste du trépied ou vitesse majorée recommandée.`);
  }
  if (w.uv >= 6 && w.clouds < 40) {
    tips.push(`Soleil dur (UV ${w.uv}) : exposez à -0.7 EV pour protéger les hautes lumières et utilisez le pare-soleil.`);
  }
  if (w.code >= 51) {
    tips.push('Précipitations détectées : protégez la lentille frontale et privilégiez les reflets sur le sol mouillé.');
  }
  if (tips.length === 0) {
    tips.push(`Conditions équilibrées pour votre ${body.name} à ${focal} mm (éq. ${effectiveFocal} mm).`);
  }

  // Mise à jour DOM
  document.getElementById('settings-context-summary').textContent =
    `${body.name} (${sensor.short}) + ${focal}mm f/${lens.maxAperture}`;
  document.getElementById('settings-ev-badge').textContent = `EV ${ev100.toFixed(1)}`;

  document.getElementById('rec-aperture').textContent = `f/${formatAperture(aperture)}`;
  document.getElementById('rec-aperture-sub').textContent = apertureSub;

  document.getElementById('rec-shutter').textContent = formatShutter(shutterSec);
  document.getElementById('rec-shutter-sub').textContent = shutterSub;

  document.getElementById('rec-iso').textContent = `ISO ${iso}`;
  document.getElementById('rec-iso-sub').textContent = isoSub;

  document.getElementById('rec-wb').textContent = `${wbKelvin} K`;
  document.getElementById('rec-wb-sub').textContent = wbLabel;

  document.getElementById('rec-tips').innerHTML = tips.map((t) =>
    `<li class="flex items-start gap-2 bg-surfaceElevated/80 p-2.5 rounded-xl border border-white/5">
      <span class="text-amber-400 mt-0.5">▸</span>
      <span>${t}</span>
    </li>`
  ).join('');
}

// ==========================================
// 8. GESTION DU MATÉRIEL (Onglet Mon Matériel)
// ==========================================
function renderQuickSelectors() {
  const bodySel = document.getElementById('quick-body-select');
  const lensSel = document.getElementById('quick-lens-select');

  bodySel.innerHTML = state.gear.bodies.map((b) =>
    `<option value="${b.id}" ${b.id === state.gear.selectedBodyId ? 'selected' : ''}>📷 ${escapeHtml(b.name)}</option>`
  ).join('');

  lensSel.innerHTML = state.gear.lenses.map((l) =>
    `<option value="${l.id}" ${l.id === state.gear.selectedLensId ? 'selected' : ''}>🔭 ${escapeHtml(l.name)}</option>`
  ).join('');
}

function renderGearEditor() {
  const bodiesEl = document.getElementById('bodies-editor');
  bodiesEl.innerHTML = state.gear.bodies.map((b, idx) => `
    <div class="rounded-2xl bg-surface border border-white/10 p-3.5 space-y-2.5">
      <p class="text-[11px] uppercase tracking-wider text-amber-400 font-semibold">Boîtier ${idx + 1}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input type="text" data-body-idx="${idx}" data-field="name" value="${escapeHtml(b.name)}"
          placeholder="Nom du boîtier"
          class="gear-body-input w-full bg-surfaceElevated border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
        <select data-body-idx="${idx}" data-field="sensor"
          class="gear-body-input w-full bg-surfaceElevated border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
          <option value="fullframe" ${b.sensor === 'fullframe' ? 'selected' : ''}>Plein Format (24×36)</option>
          <option value="apsc" ${b.sensor === 'apsc' ? 'selected' : ''}>APS-C (×1.5)</option>
          <option value="mft" ${b.sensor === 'mft' ? 'selected' : ''}>Micro 4/3 (×2.0)</option>
        </select>
      </div>
    </div>
  `).join('');

  const lensesEl = document.getElementById('lenses-editor');
  lensesEl.innerHTML = state.gear.lenses.map((l, idx) => `
    <div class="rounded-2xl bg-surface border border-white/10 p-3.5 space-y-2.5">
      <p class="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">Objectif ${idx + 1}</p>
      <input type="text" data-lens-idx="${idx}" data-field="name" value="${escapeHtml(l.name)}"
        placeholder="Ex: 24-70mm f/2.8"
        class="gear-lens-input w-full bg-surfaceElevated border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
      <div class="grid grid-cols-3 gap-2">
        <div>
          <label class="text-[10px] text-zinc-400">Focale min (mm)</label>
          <input type="number" min="8" max="800" data-lens-idx="${idx}" data-field="focalMin" value="${l.focalMin}"
            class="gear-lens-input w-full bg-surfaceElevated border border-white/10 rounded-xl px-2.5 py-1.5 text-sm font-mono text-white" />
        </div>
        <div>
          <label class="text-[10px] text-zinc-400">Focale max (mm)</label>
          <input type="number" min="8" max="800" data-lens-idx="${idx}" data-field="focalMax" value="${l.focalMax}"
            class="gear-lens-input w-full bg-surfaceElevated border border-white/10 rounded-xl px-2.5 py-1.5 text-sm font-mono text-white" />
        </div>
        <div>
          <label class="text-[10px] text-zinc-400">Ouv. max (f/)</label>
          <input type="number" step="0.1" min="0.9" max="16" data-lens-idx="${idx}" data-field="maxAperture" value="${l.maxAperture}"
            class="gear-lens-input w-full bg-surfaceElevated border border-white/10 rounded-xl px-2.5 py-1.5 text-sm font-mono text-amber-400" />
        </div>
      </div>
    </div>
  `).join('');

  // Écouteurs temps réel pour la sauvegarde automatique
  document.querySelectorAll('.gear-body-input').forEach((el) => {
    el.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.bodyIdx);
      const field = e.target.dataset.field;
      state.gear.bodies[idx][field] = e.target.value.trim() || `Boîtier ${idx + 1}`;
      saveGear();
      renderQuickSelectors();
      updateSettingsAssistant();
      showToast('Boîtier mis à jour');
    });
  });

  document.querySelectorAll('.gear-lens-input').forEach((el) => {
    el.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.lensIdx);
      const field = e.target.dataset.field;
      const val = field === 'name' ? (e.target.value.trim() || `Objectif ${idx + 1}`) : Number(e.target.value) || 1;
      state.gear.lenses[idx][field] = val;
      if (state.gear.lenses[idx].focalMax < state.gear.lenses[idx].focalMin) {
        state.gear.lenses[idx].focalMax = state.gear.lenses[idx].focalMin;
      }
      saveGear();
      renderQuickSelectors();
      updateFocalSliderVisibility();
      updateSettingsAssistant();
      showToast('Objectif mis à jour');
    });
  });
}

function loadAIConfigIntoUI() {
  document.getElementById('gemini-api-key').value = state.aiConfig.apiKey || '';
  document.getElementById('gemini-model').value = state.aiConfig.model || 'gemini-3.5-flash';
}

// ==========================================
// 9. UTILITAIRES
// ==========================================
function formatShutter(sec) {
  if (sec >= 0.8) return `${Math.round(sec * 10) / 10}s`;
  const denom = Math.round(1 / sec);
  const std = [8000, 6400, 4000, 3200, 2000, 1600, 1000, 800, 640, 500, 400, 320, 250, 200, 160, 125, 100, 80, 60, 50, 40, 30, 15, 8, 4, 2];
  const closest = std.reduce((prev, curr) => Math.abs(curr - denom) < Math.abs(prev - denom) ? curr : prev);
  return `1/${closest}s`;
}

function formatAperture(f) {
  return Number.isInteger(f) ? f : f.toFixed(1).replace('.0', '');
}

function snapIso(val) {
  const steps = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400];
  return steps.find((s) => s >= val) || 6400;
}

function formatTimeOnly(isoStr) {
  return isoStr ? isoStr.slice(11, 16) : '--:--';
}

function addMinutesToIsoTime(isoStr, deltaMin) {
  if (!isoStr) return '--:--';
  const [hh, mm] = isoStr.slice(11, 16).split(':').map(Number);
  let total = (hh * 60 + mm + deltaMin + 1440) % 1440;
  const outH = String(Math.floor(total / 60)).padStart(2, '0');
  const outM = String(total % 60).padStart(2, '0');
  return `${outH}:${outM}`;
}

function interpretWmoCode(code, isDay) {
  if (code === 0) return { label: 'Ciel dégagé', icon: isDay ? '☀️' : '🌙' };
  if (code <= 2) return { label: 'Partiellement nuageux', icon: isDay ? '🌤️' : '☁️' };
  if (code === 3) return { label: 'Couvert', icon: '☁️' };
  if (code <= 48) return { label: 'Brouillard', icon: '🌫️' };
  if (code <= 67) return { label: 'Pluie', icon: '🌧️' };
  if (code <= 77) return { label: 'Neige', icon: '❄️' };
  if (code <= 82) return { label: 'Averses', icon: '🌦️' };
  return { label: 'Orage', icon: '⛈️' };
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBearingCompass(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const brng = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const dirs = ['Nord', 'Nord-Est', 'Est', 'Sud-Est', 'Sud', 'Sud-Ouest', 'Ouest', 'Nord-Ouest'];
  return dirs[Math.round(brng / 45) % 8];
}

function setRefreshLoading(loading) {
  const icon = document.getElementById('icon-refresh');
  const label = document.getElementById('btn-refresh-label');
  icon.classList.toggle('animate-spin', loading);
  label.textContent = loading ? 'GPS...' : 'Actualiser';
}

function showGpsError(title, msg) {
  document.getElementById('gps-error-title').textContent = title;
  document.getElementById('gps-error-msg').textContent = msg;
  document.getElementById('gps-error-banner').classList.remove('hidden');
}

function hideGpsError() {
  document.getElementById('gps-error-banner').classList.add('hidden');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.add('hidden'), 2400);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
