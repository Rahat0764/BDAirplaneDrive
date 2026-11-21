import './style.css';
import * as THREE from 'three';
import { AIRCRAFT_ORDER, AIRCRAFT_SPECS, AircraftModel } from './aircraft/AircraftModel';
import { AudioSystem } from './audio/AudioSystem';
import { CAMERA_LABELS, CameraSystem } from './camera/CameraSystem';
import { InputManager } from './controls/InputManager';
import { FlightPhysics } from './flight/FlightPhysics';
import { GameplayManager } from './gameplay/GameplayManager';
import { OfflineInstaller } from './offline/OfflineInstaller';
import { clearSavedSettings, loadSavedSettings, saveSettings } from './settings/persistence';
import {
  AircraftVariantId,
  AtmospherePreset,
  AtmospherePresetId,
  GameplayModeId,
  GraphicsPresetId,
  WeatherPresetId,
} from './types';
import { IconName } from './ui/Icons';
import { UIManager } from './ui/UIManager';
import {
  applyWeatherToAtmosphere,
  ATMOSPHERE_ORDER,
  ATMOSPHERE_PRESETS,
  computeAtmosphereForHour,
  detectRecommendedGraphicsPreset,
  formatHourClock,
  getCurrentLocalHour,
  getPhaseNameForHour,
  GRAPHICS_PRESETS,
  PRESET_REPRESENTATIVE_HOUR,
  WEATHER_ORDER,
  WEATHER_PRESETS,
} from './world/AtmospherePresets';
import { CloudSystem } from './world/CloudSystem';
import { SkyAtmosphere } from './world/SkyAtmosphere';
import { TerrainSystem } from './world/TerrainSystem';
import { WeatherFX } from './world/WeatherFX';

class DreamFlightApp {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;

  private activeAtmosphereId: AtmospherePresetId = 'afternoon_moon';
  private activeWeatherId: WeatherPresetId = 'ghibli_cumulus';
  private autoDayNight = true;
  private currentHour = getCurrentLocalHour();
  private lastAutoSyncElapsed = -999;
  private activeCompositeAtm: AtmospherePreset;
  private activeGraphicsId: GraphicsPresetId;

  private sky: SkyAtmosphere;
  private clouds: CloudSystem;
  private weatherFx: WeatherFX;
  private terrain: TerrainSystem;
  private aircraft: AircraftModel;
  private physics: FlightPhysics;
  private cameraSys: CameraSystem;
  private input: InputManager;
  private audio: AudioSystem;
  private gameplay: GameplayManager;
  private ui: UIManager;

  private clock = new THREE.Clock();
  private elapsed = 0;

  private currentFps = 60;
  private fpsFrames = 0;
  private fpsAccumTime = 0;
  private adaptiveDprScale = 1.0;

  private flightStarted = false;

  constructor(installer: OfflineInstaller) {
    const canvas = document.getElementById('flight-canvas') as HTMLCanvasElement;
    const saved = loadSavedSettings();
    this.activeGraphicsId = saved.graphics ?? detectRecommendedGraphicsPreset();
    if (saved.autoDayNight !== undefined) this.autoDayNight = saved.autoDayNight;
    if (!this.autoDayNight && saved.manualHour !== undefined) this.currentHour = saved.manualHour;
    const initialQuality = GRAPHICS_PRESETS[this.activeGraphicsId];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.09;
    this.renderer.shadowMap.enabled = initialQuality.shadowsEnabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.updateRendererSize();

    this.scene = new THREE.Scene();

    this.sky = new SkyAtmosphere(this.renderer, this.scene, initialQuality);
    this.clouds = new CloudSystem(this.scene, initialQuality);
    this.weatherFx = new WeatherFX(this.scene);
    this.terrain = new TerrainSystem(this.scene, initialQuality);
    this.aircraft = new AircraftModel(this.scene);
    this.physics = new FlightPhysics();
    this.cameraSys = new CameraSystem(window.innerWidth / Math.max(1, window.innerHeight));
    this.audio = new AudioSystem();
    this.gameplay = new GameplayManager(this.scene);

    if (saved.assists) this.physics.setAssistOptions(saved.assists);
    if (saved.audio) { this.audio.settings = { ...this.audio.settings, ...saved.audio }; }
    if (saved.aircraft) { this.aircraft.buildVariant(saved.aircraft); this.physics.setVariant(saved.aircraft); }
    if (saved.weather) this.activeWeatherId = saved.weather;

    this.activeCompositeAtm = computeAtmosphereForHour(this.currentHour);

    this.input = new InputManager(canvas, (connected, label) => {
      this.ui?.showToast(
        connected ? `Connected: ${label}` : `Controller disconnected: ${label}`,
        'gamepad'
      );
    });

    this.ui = new UIManager(
      this.input,
      this.physics,
      this.cameraSys,
      this.audio,
      this.gameplay,
      installer,
      {
        onStartFlight: (
          mode: GameplayModeId,
          specialSpawn: 'none' | 'runway' | 'highway' = 'none'
        ) => {
          this.flightStarted = true;
          this.clouds.setGameplayMode(mode);
          this.gameplay.startMode(
            mode,
            this.physics,
            () => this.audio.playUiChime(true),
            specialSpawn
          );
          this.aircraft.resetTrails(this.physics.telemetry.position);
          this.cameraSys.snapToAircraft(this.physics.telemetry);
        },
        onResumeFlight: () => {
          this.flightStarted = true;
        },
        onSelectAircraft: (variant: AircraftVariantId) => {
          this.aircraft.buildVariant(variant);
          this.physics.setVariant(variant);
          this.persistSettings();
          this.aircraft.resetTrails(this.physics.telemetry.position);
        },
        onSelectAtmosphere: (presetId: AtmospherePresetId) => {
          this.autoDayNight = false;
          this.activeAtmosphereId = presetId;
          this.currentHour = PRESET_REPRESENTATIVE_HOUR[presetId];
          this.refreshEnvironment(ATMOSPHERE_PRESETS[presetId]);
        },
        onSelectWeather: (weatherId: WeatherPresetId) => {
          this.applyWeather(weatherId, true);
          this.persistSettings();
        },
        onCycleWeather: () => {
          this.cycleWeather();
        },
        onSetAutoDayNight: (enabled: boolean) => {
          this.autoDayNight = enabled;
          this.persistSettings();
          if (enabled) {
            this.currentHour = getCurrentLocalHour();
            this.refreshEnvironment(computeAtmosphereForHour(this.currentHour));
            this.ui.showToast(
              `Auto Real-Time Sky (${formatHourClock(this.currentHour)})`,
              'clock'
            );
          }
        },
        onSetManualHour: (hour: number) => {
          this.autoDayNight = false;
          this.currentHour = hour;
          this.refreshEnvironment(computeAtmosphereForHour(hour));
          this.persistSettings();
        },
        onSelectGraphics: (gfxId: GraphicsPresetId) => {
          this.applyGraphics(gfxId);
          this.persistSettings();
        },
        getActiveAircraft: () => this.aircraft.getVariant(),
        getActiveAtmosphere: () => this.activeAtmosphereId,
        getActiveWeather: () => this.activeWeatherId,
        isAutoDayNight: () => this.autoDayNight,
        getCurrentHour: () => this.currentHour,
        getActiveGraphics: () => this.activeGraphicsId,
        getCurrentFps: () => this.currentFps,
        onPersistSettings: () => this.persistSettings(),
        onResetSavedSettings: () => { clearSavedSettings(); },
      }
    );
    if (saved.hudMode) this.ui.setHudMode(saved.hudMode);

    // Initialize Real-Time Day-Night Sky + Default Ghibli Cumulus Weather
    this.applyWeather(this.activeWeatherId, false);
    this.refreshEnvironment(computeAtmosphereForHour(this.currentHour));
    this.aircraft.resetTrails(this.physics.telemetry.position);
    this.cameraSys.snapToAircraft(this.physics.telemetry);

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => {
      window.setTimeout(() => this.onResize(), 120);
    });
    window.addEventListener('wheel', (e) => {
      if (!this.ui.isMenuOpen()) {
        this.cameraSys.adjustOrbitZoom(Math.sign(e.deltaY) * 1.4);
      }
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    (window as unknown as Record<string, unknown>).__DREAM_FLIGHT__ = {
      getTelemetry: () => this.physics.telemetry,
      getAtmosphere: () => this.activeAtmosphereId,
      getWeather: () => this.activeWeatherId,
      getCameraMode: () => this.cameraSys.getMode(),
      getFps: () => this.currentFps,
    };

    this.clock.start();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private persistSettings(): void {
    saveSettings({
      assists: this.physics.getAssistOptions(),
      graphics: this.activeGraphicsId,
      aircraft: this.aircraft.getVariant(),
      weather: this.activeWeatherId,
      autoDayNight: this.autoDayNight,
      manualHour: this.currentHour,
      hudMode: this.ui ? this.ui.getHudMode() : undefined,
      audio: { ...this.audio.settings },
      cameraMode: this.cameraSys.getMode(),
    });
  }

  private refreshEnvironment(baseAtm: AtmospherePreset): void {
    const weather = WEATHER_PRESETS[this.activeWeatherId];
    this.activeAtmosphereId = baseAtm.id;
    this.activeCompositeAtm = applyWeatherToAtmosphere(baseAtm, weather);

    this.sky.applyPreset(this.activeCompositeAtm, this.scene, this.renderer);
    this.clouds.applyPreset(this.activeCompositeAtm, this.sky.sunDirection);
    this.terrain.applyPreset(this.activeCompositeAtm, this.sky.sunDirection);
  }

  private applyWeather(weatherId: WeatherPresetId, notify = true): void {
    this.activeWeatherId = weatherId;
    const weather = WEATHER_PRESETS[weatherId];
    this.clouds.applyWeather(weather);
    this.weatherFx.applyWeather(weather);

    const baseAtm = this.autoDayNight
      ? computeAtmosphereForHour(this.currentHour)
      : computeAtmosphereForHour(this.currentHour);
    this.refreshEnvironment(baseAtm);

    if (notify) {
      this.ui.showToast(`Weather: ${weather.name}`, weather.icon as IconName);
    }
  }

  private cycleWeather(): void {
    const idx = WEATHER_ORDER.indexOf(this.activeWeatherId);
    const next = WEATHER_ORDER[(idx + 1) % WEATHER_ORDER.length];
    this.applyWeather(next, true);
  }

  private cycleTimePreset(): void {
    if (this.autoDayNight) {
      this.autoDayNight = false;
      const next = ATMOSPHERE_ORDER[0];
      this.currentHour = PRESET_REPRESENTATIVE_HOUR[next];
      this.refreshEnvironment(ATMOSPHERE_PRESETS[next]);
      this.ui.showToast(`Time: ${ATMOSPHERE_PRESETS[next].name}`, 'sun');
    } else {
      const idx = ATMOSPHERE_ORDER.indexOf(this.activeAtmosphereId);
      if (idx === ATMOSPHERE_ORDER.length - 1) {
        this.autoDayNight = true;
        this.currentHour = getCurrentLocalHour();
        this.refreshEnvironment(computeAtmosphereForHour(this.currentHour));
        this.ui.showToast(
          `Time: Auto Real-Time (${formatHourClock(this.currentHour)} · ${getPhaseNameForHour(this.currentHour)})`,
          'clock'
        );
      } else {
        const next = ATMOSPHERE_ORDER[idx + 1];
        this.currentHour = PRESET_REPRESENTATIVE_HOUR[next];
        this.refreshEnvironment(ATMOSPHERE_PRESETS[next]);
        this.ui.showToast(`Time: ${ATMOSPHERE_PRESETS[next].name}`, 'sun');
      }
    }
  }

  private applyGraphics(gfxId: GraphicsPresetId): void {
    this.activeGraphicsId = gfxId;
    this.adaptiveDprScale = 1.0;
    const q = GRAPHICS_PRESETS[gfxId];

    this.renderer.shadowMap.enabled = q.shadowsEnabled;
    this.cameraSys.camera.far = Math.max(28000, q.drawDistance + 6000);
    this.cameraSys.camera.updateProjectionMatrix();

    this.sky.applyGraphicsQuality(q);
    this.clouds.applyGraphicsQuality(q);
    this.terrain.applyGraphicsQuality(q);
    this.updateRendererSize();
  }

  private updateRendererSize(): void {
    const q = GRAPHICS_PRESETS[this.activeGraphicsId];
    const targetDpr = Math.min(window.devicePixelRatio || 1, q.maxDpr) * this.adaptiveDprScale;
    this.renderer.setPixelRatio(Math.max(0.75, targetDpr));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  private onResize(): void {
    this.updateRendererSize();
    this.cameraSys.resize(window.innerWidth / Math.max(1, window.innerHeight));
  }

  private updateAdaptivePerformance(dt: number): void {
    this.fpsFrames++;
    this.fpsAccumTime += dt;
    if (this.fpsAccumTime < 0.5) return;

    this.currentFps = this.fpsFrames / this.fpsAccumTime;
    this.fpsFrames = 0;
    this.fpsAccumTime = 0;

    const q = GRAPHICS_PRESETS[this.activeGraphicsId];
    if (!q.adaptiveResolution) return;

    if (this.currentFps < 45 && this.adaptiveDprScale > 0.62) {
      this.adaptiveDprScale = Math.max(0.6, this.adaptiveDprScale - 0.12);
      this.updateRendererSize();
    } else if (this.currentFps > 57 && this.adaptiveDprScale < 1.0) {
      this.adaptiveDprScale = Math.min(1.0, this.adaptiveDprScale + 0.08);
      this.updateRendererSize();
    }
  }

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    this.updateAdaptivePerformance(dt);

    // Periodically sync real-time day-night clock smoothly every 15 seconds when Auto is enabled
    if (this.autoDayNight && this.elapsed - this.lastAutoSyncElapsed > 15.0) {
      this.lastAutoSyncElapsed = this.elapsed;
      this.currentHour = getCurrentLocalHour();
      this.refreshEnvironment(computeAtmosphereForHour(this.currentHour));
    }

    const inMenu = this.ui.isMenuOpen();
    const inputs = this.input.poll(inMenu);

    if (inMenu) {
      this.ui.handleControllerMenuNav(inputs.menuNav);
    }

    if (inputs.togglePause && this.flightStarted) {
      if (inMenu) {
        this.ui.closeMenu();
      } else {
        this.ui.openMenu(true);
      }
    }

    if (!inMenu && this.input.consumeHudCycle()) {
      this.ui.cycleHudMode();
    }

    if (!inMenu && inputs.switchCamera) {
      const nextCam = this.cameraSys.cycleMode();
      this.ui.showToast(`Camera: ${CAMERA_LABELS[nextCam]}`, 'camera');
    }

    if (!inMenu && inputs.cycleWeather) {
      this.audio.playUiChime();
      this.cycleWeather();
    }

    if (!inMenu && inputs.cycleTime) {
      this.audio.playUiChime();
      this.cycleTimePreset();
    }

    if (!inMenu && inputs.cycleAircraft) {
      const idx = AIRCRAFT_ORDER.indexOf(this.aircraft.getVariant());
      const next = AIRCRAFT_ORDER[(idx + 1) % AIRCRAFT_ORDER.length];
      this.aircraft.buildVariant(next);
      this.physics.setVariant(next);
      this.aircraft.resetTrails(this.physics.telemetry.position);
      this.audio.playUiChime(true);
      this.ui.showToast(`Aircraft: ${AIRCRAFT_SPECS[next].name}`, 'plane');
    }

    if (!inMenu && inputs.toggleZoom) {
      const label = this.cameraSys.cycleZoomPreset();
      this.ui.showToast(`Camera Distance: ${label}`, 'zoom');
    }

    if (!inMenu && inputs.resetAircraft && !this.physics.telemetry.crashed) {
      this.physics.recoverInAir();
      this.aircraft.resetTrails(this.physics.telemetry.position);
      this.ui.showToast('Aircraft stabilized in sky', 'reset');
    }

    const preset = this.activeCompositeAtm;
    const weather = WEATHER_PRESETS[this.activeWeatherId];
    const cloudDensity = this.clouds.getCloudDensityAt(this.physics.telemetry.position);

    if (!inMenu) {
      this.physics.update(
        dt,
        inputs,
        (x, z) => this.terrain.getTerrainHeight(x, z),
        (x, z) => this.terrain.getWaterSurfaceHeight(x, z),
        (x, z) => this.terrain.classifySurface(x, z),
        cloudDensity,
        weather.turbulenceBoost
      );

      const h = this.physics.telemetry.haptics;
      this.input.processFlightHaptics(dt, h, this.physics.telemetry.stalling);
      if (h.touchdownIntensity > 0.05) {
        this.audio.playTouchdownSound(h.touchdownIntensity, false);
      } else if (h.scrapeIntensity > 0.05) {
        this.audio.playTouchdownSound(
          h.scrapeIntensity,
          this.physics.telemetry.surfaceType === 'water'
        );
      }
    } else if (!this.flightStarted) {
      const showcaseIn = {
        ...inputs,
        pitch: Math.sin(this.elapsed * 0.35) * 0.03,
        roll: Math.sin(this.elapsed * 0.24) * 0.08,
        yaw: 0,
        throttleDelta: 0,
        throttleDirect: 0.66,
        airbrake: false,
        toggleGear: false,
        switchCamera: false,
        cycleWeather: false,
        cycleTime: false,
        cycleAircraft: false,
        toggleZoom: false,
        resetAircraft: false,
        togglePause: false,
      };
      this.physics.update(
        dt * 0.75,
        showcaseIn,
        (x, z) => this.terrain.getTerrainHeight(x, z),
        (x, z) => this.terrain.getWaterSurfaceHeight(x, z),
        (x, z) => this.terrain.classifySurface(x, z),
        cloudDensity,
        0
      );
      if (this.physics.telemetry.position.z < -4800) {
        this.physics.telemetry.position.z = 520;
        this.physics.telemetry.position.x = -12;
        this.physics.telemetry.position.y = 540;
        this.aircraft.resetTrails(this.physics.telemetry.position);
        this.cameraSys.snapToAircraft(this.physics.telemetry);
      }
    }

    if (this.scene.fog instanceof THREE.FogExp2) {
      const targetFog = preset.fogDensity + cloudDensity * 0.0022;
      this.scene.fog.density += (targetFog - this.scene.fog.density) * Math.min(1, dt * 5.0);
      this.scene.fog.color
        .copy(preset.fogColor)
        .lerp(preset.cloudBrightColor, cloudDensity * 0.68);
    }

    const telem = this.physics.telemetry;

    this.aircraft.update(dt, this.elapsed, telem, preset.nightLights);
    this.cameraSys.update(dt, telem, this.aircraft, inputs, inMenu && !this.flightStarted);
    this.sky.update(this.elapsed, telem.position);
    this.clouds.update(dt, this.elapsed, telem.position, cloudDensity);
    this.weatherFx.update(dt, this.elapsed, telem.position, telem.velocity);
    this.terrain.update(this.elapsed, telem.position);

    const gpStatus = this.gameplay.update(dt, this.elapsed, telem, this.terrain.airport, () =>
      this.audio.playUiChime(true)
    );
    this.audio.update(dt, telem, inMenu && this.flightStarted, inMenu);
    this.ui.update(telem, gpStatus, inputs.activeSource);

    this.renderer.render(this.scene, this.cameraSys.camera);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const installer = new OfflineInstaller();
  await installer.ensureInstalledToBrowser();
  new DreamFlightApp(installer);
});
