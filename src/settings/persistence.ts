import { AircraftVariantId, AudioSettings, FlightAssistOptions, GraphicsPresetId, HudModeId, WeatherPresetId } from '../types';

export interface SavedSettings {
  assists?: Partial<FlightAssistOptions>;
  graphics?: GraphicsPresetId;
  aircraft?: AircraftVariantId;
  weather?: WeatherPresetId;
  autoDayNight?: boolean;
  manualHour?: number;
  hudMode?: HudModeId;
  audio?: Partial<AudioSettings>;
  cameraMode?: string;
}
const KEY = 'dream_flight_settings_v1';
export function loadSavedSettings(): SavedSettings {
  try { const r = localStorage.getItem(KEY); return r ? (JSON.parse(r) as SavedSettings) : {}; } catch { return {}; }
}
export function saveSettings(patch: Partial<SavedSettings>): void {
  try { const cur = loadSavedSettings(); localStorage.setItem(KEY, JSON.stringify({ ...cur, ...patch })); } catch {}
}
export function clearSavedSettings(): void { try { localStorage.removeItem(KEY); } catch {} }
