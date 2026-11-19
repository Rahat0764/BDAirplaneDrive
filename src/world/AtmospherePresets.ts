import * as THREE from 'three';
import {
  AtmospherePreset,
  AtmospherePresetId,
  GraphicsConfig,
  GraphicsPresetId,
  WeatherConfig,
  WeatherPresetId,
} from '../types';

export const ATMOSPHERE_PRESETS: Record<AtmospherePresetId, AtmospherePreset> = {
  afternoon_moon: {
    id: 'afternoon_moon',
    name: 'Ghibli Afternoon',
    subtitle: 'Crisp cobalt-cerulean sky, luminous white cumulus & bright daytime moon',
    sunElevationDeg: 52,
    sunAzimuthDeg: -52,
    moonElevationDeg: 27,
    moonAzimuthDeg: 22,
    moonVisibility: 0.92,
    starVisibility: 0.0,
    skyZenith: new THREE.Color('#093275'),
    skyUpper: new THREE.Color('#1f6cc4'),
    skyHorizon: new THREE.Color('#92ccf7'),
    skyGroundBounce: new THREE.Color('#4a7b5c'),
    sunColor: new THREE.Color('#fffbf2'),
    sunIntensity: 3.3,
    hemiSkyColor: new THREE.Color('#80bef7'),
    hemiGroundColor: new THREE.Color('#3f6b43'),
    hemiIntensity: 1.2,
    cloudBrightColor: new THREE.Color('#ffffff'),
    cloudMidColor: new THREE.Color('#d9e8fa'),
    cloudShadowColor: new THREE.Color('#5a84bc'),
    cloudRimColor: new THREE.Color('#ffffff'),
    fogColor: new THREE.Color('#9cd0f7'),
    fogDensity: 0.000048,
    exposure: 1.1,
    nightLights: 0.0,
  },
  morning: {
    id: 'morning',
    name: 'Sunlit Morning',
    subtitle: 'Fresh peach-gold sunrise light, vibrant spring meadows & crisp valley air',
    sunElevationDeg: 22,
    sunAzimuthDeg: -72,
    moonElevationDeg: 18,
    moonAzimuthDeg: 68,
    moonVisibility: 0.42,
    starVisibility: 0.0,
    skyZenith: new THREE.Color('#18509a'),
    skyUpper: new THREE.Color('#4c90d4'),
    skyHorizon: new THREE.Color('#f7e0cb'),
    skyGroundBounce: new THREE.Color('#648262'),
    sunColor: new THREE.Color('#ffecd2'),
    sunIntensity: 2.8,
    hemiSkyColor: new THREE.Color('#a4cbf0'),
    hemiGroundColor: new THREE.Color('#4d6b47'),
    hemiIntensity: 1.12,
    cloudBrightColor: new THREE.Color('#fff9f0'),
    cloudMidColor: new THREE.Color('#e4e7f4'),
    cloudShadowColor: new THREE.Color('#6f8cb8'),
    cloudRimColor: new THREE.Color('#fff0d8'),
    fogColor: new THREE.Color('#e2e4ee'),
    fogDensity: 0.000062,
    exposure: 1.09,
    nightLights: 0.06,
  },
  golden_hour: {
    id: 'golden_hour',
    name: 'Golden Hour',
    subtitle: 'Warm honey-amber sunlight, long crisp shadows & gilded cumulus crowns',
    sunElevationDeg: 12,
    sunAzimuthDeg: -34,
    moonElevationDeg: 25,
    moonAzimuthDeg: 45,
    moonVisibility: 0.58,
    starVisibility: 0.05,
    skyZenith: new THREE.Color('#153b75'),
    skyUpper: new THREE.Color('#3c72ad'),
    skyHorizon: new THREE.Color('#fabf7e'),
    skyGroundBounce: new THREE.Color('#70583e'),
    sunColor: new THREE.Color('#ffc985'),
    sunIntensity: 2.85,
    hemiSkyColor: new THREE.Color('#d2a88a'),
    hemiGroundColor: new THREE.Color('#4d4130'),
    hemiIntensity: 1.0,
    cloudBrightColor: new THREE.Color('#ffebd0'),
    cloudMidColor: new THREE.Color('#d8b5a8'),
    cloudShadowColor: new THREE.Color('#536a96'),
    cloudRimColor: new THREE.Color('#ffd999'),
    fogColor: new THREE.Color('#e8be98'),
    fogDensity: 0.000064,
    exposure: 1.07,
    nightLights: 0.35,
  },
  sunset: {
    id: 'sunset',
    name: 'Coral Sunset',
    subtitle: 'Warm rose-apricot clouds, glowing horizon & lantern-lit valley villages',
    sunElevationDeg: 4.0,
    sunAzimuthDeg: -16,
    moonElevationDeg: 32,
    moonAzimuthDeg: 38,
    moonVisibility: 0.86,
    starVisibility: 0.28,
    skyZenith: new THREE.Color('#142052'),
    skyUpper: new THREE.Color('#474282'),
    skyHorizon: new THREE.Color('#fa8862'),
    skyGroundBounce: new THREE.Color('#4f3440'),
    sunColor: new THREE.Color('#ff9866'),
    sunIntensity: 2.25,
    hemiSkyColor: new THREE.Color('#aa7290'),
    hemiGroundColor: new THREE.Color('#302836'),
    hemiIntensity: 0.9,
    cloudBrightColor: new THREE.Color('#ffc6a8'),
    cloudMidColor: new THREE.Color('#b27d96'),
    cloudShadowColor: new THREE.Color('#3d4678'),
    cloudRimColor: new THREE.Color('#ffaa7c'),
    fogColor: new THREE.Color('#c68086'),
    fogDensity: 0.000068,
    exposure: 1.06,
    nightLights: 0.82,
  },
  blue_hour: {
    id: 'blue_hour',
    name: 'Moonlit Blue Hour',
    subtitle: 'Deep sapphire twilight, radiant full moon & glowing village and road lights',
    sunElevationDeg: 26,
    sunAzimuthDeg: 22,
    moonElevationDeg: 30,
    moonAzimuthDeg: 22,
    moonVisibility: 1.0,
    starVisibility: 0.85,
    skyZenith: new THREE.Color('#061433'),
    skyUpper: new THREE.Color('#12346e'),
    skyHorizon: new THREE.Color('#3468a6'),
    skyGroundBounce: new THREE.Color('#182c47'),
    sunColor: new THREE.Color('#e2eeff'),
    sunIntensity: 1.7,
    hemiSkyColor: new THREE.Color('#4d7ebd'),
    hemiGroundColor: new THREE.Color('#152336'),
    hemiIntensity: 0.88,
    cloudBrightColor: new THREE.Color('#ebf3ff'),
    cloudMidColor: new THREE.Color('#95b4de'),
    cloudShadowColor: new THREE.Color('#274372'),
    cloudRimColor: new THREE.Color('#f8fbff'),
    fogColor: new THREE.Color('#2d588e'),
    fogDensity: 0.00006,
    exposure: 1.14,
    nightLights: 1.0,
  },
  midnight: {
    id: 'midnight',
    name: 'Starlit Midnight',
    subtitle: 'Crystal-clear indigo night sky, bright silver moon & shimmering coastal lighthouse',
    sunElevationDeg: 34,
    sunAzimuthDeg: 18,
    moonElevationDeg: 38,
    moonAzimuthDeg: 18,
    moonVisibility: 1.0,
    starVisibility: 1.0,
    skyZenith: new THREE.Color('#03091a'),
    skyUpper: new THREE.Color('#0a1c3f'),
    skyHorizon: new THREE.Color('#1c3c6b'),
    skyGroundBounce: new THREE.Color('#0d192b'),
    sunColor: new THREE.Color('#cfe2ff'),
    sunIntensity: 1.35,
    hemiSkyColor: new THREE.Color('#33588f'),
    hemiGroundColor: new THREE.Color('#0e1726'),
    hemiIntensity: 0.78,
    cloudBrightColor: new THREE.Color('#d2e3fa'),
    cloudMidColor: new THREE.Color('#6f8eb8'),
    cloudShadowColor: new THREE.Color('#1b2e52'),
    cloudRimColor: new THREE.Color('#eaf3ff'),
    fogColor: new THREE.Color('#183359'),
    fogDensity: 0.000056,
    exposure: 1.12,
    nightLights: 1.0,
  },
};

export const ATMOSPHERE_ORDER: AtmospherePresetId[] = [
  'morning',
  'afternoon_moon',
  'golden_hour',
  'sunset',
  'blue_hour',
  'midnight',
];

export const PRESET_REPRESENTATIVE_HOUR: Record<AtmospherePresetId, number> = {
  morning: 8.2,
  afternoon_moon: 13.5,
  golden_hour: 16.8,
  sunset: 18.2,
  blue_hour: 19.6,
  midnight: 23.0,
};

export const WEATHER_PRESETS: Record<WeatherPresetId, WeatherConfig> = {
  ghibli_cumulus: {
    id: 'ghibli_cumulus',
    name: 'Ghibli Cumulus',
    icon: 'cloud-sun',
    subtitle: 'Towering painterly sunlit clouds with crystal-clear valley visibility',
    cloudDensityMult: 1.0,
    cloudDarken: 0.0,
    fogMultiplier: 1.0,
    rainIntensity: 0.0,
    petalIntensity: 0.0,
    windStrength: 1.0,
    turbulenceBoost: 0.0,
    sunDim: 1.0,
  },
  clear: {
    id: 'clear',
    name: 'Crystal Clear',
    icon: 'sun',
    subtitle: 'Ultra-sharp horizon visibility with light scattered fair-weather puffs',
    cloudDensityMult: 0.58,
    cloudDarken: 0.0,
    fogMultiplier: 0.65,
    rainIntensity: 0.0,
    petalIntensity: 0.0,
    windStrength: 0.75,
    turbulenceBoost: 0.0,
    sunDim: 1.08,
  },
  golden_breeze: {
    id: 'golden_breeze',
    name: 'Meadow Breeze',
    icon: 'wind',
    subtitle: 'Warm sunlit sky with drifting valley pollen & gentle updrafts',
    cloudDensityMult: 0.86,
    cloudDarken: 0.0,
    fogMultiplier: 0.9,
    rainIntensity: 0.0,
    petalIntensity: 1.0,
    windStrength: 1.35,
    turbulenceBoost: 0.12,
    sunDim: 1.04,
  },
  misty_valley: {
    id: 'misty_valley',
    name: 'Misty Valley',
    icon: 'mist',
    subtitle: 'Soft drifting alpine mist hugging the emerald valley & coastal bay',
    cloudDensityMult: 1.12,
    cloudDarken: 0.14,
    fogMultiplier: 1.85,
    rainIntensity: 0.0,
    petalIntensity: 0.0,
    windStrength: 0.85,
    turbulenceBoost: 0.08,
    sunDim: 0.88,
  },
  rain_shower: {
    id: 'rain_shower',
    name: 'Rain Shower',
    icon: 'rain',
    subtitle: 'Silver rain streaks, dramatic storm-bellied clouds & brisk crosswinds',
    cloudDensityMult: 1.25,
    cloudDarken: 0.36,
    fogMultiplier: 2.1,
    rainIntensity: 1.0,
    petalIntensity: 0.0,
    windStrength: 1.85,
    turbulenceBoost: 0.45,
    sunDim: 0.64,
  },
};

export const WEATHER_ORDER: WeatherPresetId[] = [
  'ghibli_cumulus',
  'clear',
  'golden_breeze',
  'misty_valley',
  'rain_shower',
];

const SOLAR_KEYFRAMES: Array<{ hour: number; preset: AtmospherePresetId }> = [
  { hour: 0.0, preset: 'midnight' },
  { hour: 4.5, preset: 'midnight' },
  { hour: 5.8, preset: 'blue_hour' },
  { hour: 7.5, preset: 'morning' },
  { hour: 11.0, preset: 'afternoon_moon' },
  { hour: 15.2, preset: 'afternoon_moon' },
  { hour: 16.9, preset: 'golden_hour' },
  { hour: 18.2, preset: 'sunset' },
  { hour: 19.4, preset: 'blue_hour' },
  { hour: 21.2, preset: 'midnight' },
  { hour: 24.0, preset: 'midnight' },
];

export function getCurrentLocalHour(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

export function formatHourClock(hourFloat: number): string {
  const hNorm = ((hourFloat % 24) + 24) % 24;
  const h = Math.floor(hNorm);
  const m = Math.floor((hNorm - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function getPhaseNameForHour(hourFloat: number): string {
  const h = ((hourFloat % 24) + 24) % 24;
  if (h >= 5.2 && h < 7.0) return 'Dawn';
  if (h >= 7.0 && h < 11.2) return 'Morning';
  if (h >= 11.2 && h < 15.8) return 'Afternoon';
  if (h >= 15.8 && h < 17.6) return 'Golden Hour';
  if (h >= 17.6 && h < 19.0) return 'Sunset';
  if (h >= 19.0 && h < 20.6) return 'Blue Hour';
  return 'Night';
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function cloneAndLerpAtmosphere(
  a: AtmospherePreset,
  b: AtmospherePreset,
  t: number
): AtmospherePreset {
  const s = t * t * (3 - 2 * t);
  return {
    id: s < 0.5 ? a.id : b.id,
    name: s < 0.5 ? a.name : b.name,
    subtitle: s < 0.5 ? a.subtitle : b.subtitle,
    sunElevationDeg: lerpNum(a.sunElevationDeg, b.sunElevationDeg, s),
    sunAzimuthDeg: lerpNum(a.sunAzimuthDeg, b.sunAzimuthDeg, s),
    moonElevationDeg: lerpNum(a.moonElevationDeg, b.moonElevationDeg, s),
    moonAzimuthDeg: lerpNum(a.moonAzimuthDeg, b.moonAzimuthDeg, s),
    moonVisibility: lerpNum(a.moonVisibility, b.moonVisibility, s),
    starVisibility: lerpNum(a.starVisibility, b.starVisibility, s),
    skyZenith: a.skyZenith.clone().lerp(b.skyZenith, s),
    skyUpper: a.skyUpper.clone().lerp(b.skyUpper, s),
    skyHorizon: a.skyHorizon.clone().lerp(b.skyHorizon, s),
    skyGroundBounce: a.skyGroundBounce.clone().lerp(b.skyGroundBounce, s),
    sunColor: a.sunColor.clone().lerp(b.sunColor, s),
    sunIntensity: lerpNum(a.sunIntensity, b.sunIntensity, s),
    hemiSkyColor: a.hemiSkyColor.clone().lerp(b.hemiSkyColor, s),
    hemiGroundColor: a.hemiGroundColor.clone().lerp(b.hemiGroundColor, s),
    hemiIntensity: lerpNum(a.hemiIntensity, b.hemiIntensity, s),
    cloudBrightColor: a.cloudBrightColor.clone().lerp(b.cloudBrightColor, s),
    cloudMidColor: a.cloudMidColor.clone().lerp(b.cloudMidColor, s),
    cloudShadowColor: a.cloudShadowColor.clone().lerp(b.cloudShadowColor, s),
    cloudRimColor: a.cloudRimColor.clone().lerp(b.cloudRimColor, s),
    fogColor: a.fogColor.clone().lerp(b.fogColor, s),
    fogDensity: lerpNum(a.fogDensity, b.fogDensity, s),
    exposure: lerpNum(a.exposure, b.exposure, s),
    nightLights: lerpNum(a.nightLights, b.nightLights, s),
  };
}

export function computeAtmosphereForHour(hourFloat: number): AtmospherePreset {
  const h = ((hourFloat % 24) + 24) % 24;
  for (let i = 0; i < SOLAR_KEYFRAMES.length - 1; i++) {
    const k0 = SOLAR_KEYFRAMES[i];
    const k1 = SOLAR_KEYFRAMES[i + 1];
    if (h >= k0.hour && h <= k1.hour) {
      const span = Math.max(0.001, k1.hour - k0.hour);
      const t = (h - k0.hour) / span;
      return cloneAndLerpAtmosphere(
        ATMOSPHERE_PRESETS[k0.preset],
        ATMOSPHERE_PRESETS[k1.preset],
        t
      );
    }
  }
  return cloneAndLerpAtmosphere(
    ATMOSPHERE_PRESETS.afternoon_moon,
    ATMOSPHERE_PRESETS.afternoon_moon,
    0
  );
}

const STORM_SLATE = new THREE.Color('#475c78');
const STORM_CLOUD_DARK = new THREE.Color('#2c3d57');

export function applyWeatherToAtmosphere(
  base: AtmospherePreset,
  weather: WeatherConfig
): AtmospherePreset {
  const d = weather.cloudDarken;
  return {
    ...base,
    skyZenith: base.skyZenith.clone().lerp(STORM_SLATE, d * 0.55),
    skyUpper: base.skyUpper.clone().lerp(STORM_SLATE, d * 0.62),
    skyHorizon: base.skyHorizon.clone().lerp(STORM_SLATE, d * 0.45),
    skyGroundBounce: base.skyGroundBounce.clone(),
    sunColor: base.sunColor.clone(),
    sunIntensity: base.sunIntensity * weather.sunDim,
    hemiSkyColor: base.hemiSkyColor.clone().lerp(STORM_SLATE, d * 0.4),
    hemiGroundColor: base.hemiGroundColor.clone(),
    hemiIntensity: base.hemiIntensity * (0.9 + 0.1 * weather.sunDim),
    cloudBrightColor: base.cloudBrightColor.clone().lerp(new THREE.Color('#cad6e5'), d * 0.72),
    cloudMidColor: base.cloudMidColor.clone().lerp(STORM_SLATE, d * 0.68),
    cloudShadowColor: base.cloudShadowColor.clone().lerp(STORM_CLOUD_DARK, d * 0.75),
    cloudRimColor: base.cloudRimColor.clone().lerp(new THREE.Color('#d8e4f2'), d * 0.5),
    fogColor: base.fogColor.clone().lerp(STORM_SLATE, d * 0.52),
    fogDensity: base.fogDensity * weather.fogMultiplier,
    exposure: base.exposure * (1.0 - d * 0.08),
  };
}

export const GRAPHICS_PRESETS: Record<GraphicsPresetId, GraphicsConfig> = {
  low: {
    id: 'low',
    label: 'Low (Mobile Smooth + Crisp Shadows)',
    maxDpr: 1.25,
    adaptiveResolution: true,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    cloudClusterCount: 44,
    cloudLobesPerCluster: 12,
    skyRaymarchSteps: 8,
    terrainSegments: 176,
    drawDistance: 15500,
    treeCount: 1900,
    buildingCount: 95,
    mistParticles: 24,
  },
  medium: {
    id: 'medium',
    label: 'Medium (Balanced Ghibli Realism)',
    maxDpr: 1.6,
    adaptiveResolution: true,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    cloudClusterCount: 64,
    cloudLobesPerCluster: 16,
    skyRaymarchSteps: 12,
    terrainSegments: 232,
    drawDistance: 19500,
    treeCount: 3800,
    buildingCount: 145,
    mistParticles: 40,
  },
  high: {
    id: 'high',
    label: 'High (Cinematic Detail)',
    maxDpr: 2.0,
    adaptiveResolution: true,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    cloudClusterCount: 84,
    cloudLobesPerCluster: 20,
    skyRaymarchSteps: 16,
    terrainSegments: 288,
    drawDistance: 23500,
    treeCount: 6200,
    buildingCount: 195,
    mistParticles: 58,
  },
  ultra: {
    id: 'ultra',
    label: 'Ultra (Maximum Fidelity)',
    maxDpr: 2.25,
    adaptiveResolution: false,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    cloudClusterCount: 104,
    cloudLobesPerCluster: 24,
    skyRaymarchSteps: 20,
    terrainSegments: 336,
    drawDistance: 27000,
    treeCount: 8800,
    buildingCount: 245,
    mistParticles: 76,
  },
};

export function detectRecommendedGraphicsPreset(): GraphicsPresetId {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory || 4;
  if (isMobile) {
    if (cores >= 8 && mem >= 6) return 'medium';
    return 'low';
  }
  if (cores >= 8 && mem >= 8) return 'high';
  return 'medium';
}
