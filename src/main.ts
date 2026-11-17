import './style.css';
import * as THREE from 'three';
import { AircraftModel } from './aircraft/AircraftModel';
import { AudioSystem } from './audio/AudioSystem';
import { CAMERA_LABELS, CameraSystem } from './camera/CameraSystem';
import { InputManager } from './controls/InputManager';
import { FlightPhysics } from './flight/FlightPhysics';
import { GameplayManager } from './gameplay/GameplayManager';
import {
  AircraftVariantId,
  AtmospherePresetId,
  GameplayModeId,
  GraphicsPresetId,
} from './types';
import { UIManager } from './ui/UIManager';
import {
  ATMOSPHERE_PRESETS,
  detectRecommendedGraphicsPreset,
  GRAPHICS_PRESETS,
} from './world/AtmospherePresets';
import { CloudSystem } from './world/CloudSystem';
import { SkyAtmosphere } from './world/SkyAtmosphere';
import { TerrainSystem } from './world/TerrainSystem';

class DreamFlightApp {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;

  private activeAtmosphereId: AtmospherePresetId = 'afternoon_moon';
  private activeGraphicsId: GraphicsPresetId;

  private sky: SkyAtmosphere;
  private clouds: CloudSystem;
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

  constructor() {
    const canvas = document.getElementById('flight-canvas') as HTMLCanvasElement;
    this.activeGraphicsId = detectRecommendedGraphicsPreset();
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
    this.terrain = new TerrainSystem(this.scene, initialQuality);
    this.aircraft = new AircraftModel(this.scene);
    this.physics = new FlightPhysics();
    this.cameraSys = new CameraSystem(window.innerWidth / Math.max(1, window.innerHeight));
    this.audio = new AudioSystem();
    this.gameplay = new GameplayManager(this.scene);

    this.input = new InputManager(canvas, (connected, label) => {
      this.ui?.showToast(
        connected ? `🎮 Connected: ${label}` : `Controller disconnected: ${label}`
      );
    });

    this.ui = new UIManager(
      this.input,
      this.physics,
      this.cameraSys,
      this.audio,
      this.gameplay,
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
          this.aircraft.resetTrails(this.physics.telemetry.position);
        },
        onSelectAtmosphere: (presetId: AtmospherePresetId) => {
          this.applyAtmosphere(presetId);
        },
        onSelectGraphics: (gfxId: GraphicsPresetId) => {
          this.applyGraphics(gfxId);
        },
        getActiveAircraft: () => this.aircraft.getVariant(),
        getActiveAtmosphere: () => this.activeAtmosphereId,
        getActiveGraphics: () => this.activeGraphicsId,
        getCurrentFps: () => this.currentFps,
      }
    );

    this.applyAtmosphere('afternoon_moon');
    this.aircraft.resetTrails(this.physics.telemetry.position);
    this.cameraSys.snapToAircraft(this.physics.telemetry);

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => {
      window.setTimeout(() => this.onResize(), 120);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    (window as unknown as Record<string, unknown>).__DREAM_FLIGHT__ = {
      getTelemetry: () => this.physics.telemetry,
      getAtmosphere: () => this.activeAtmosphereId,
      getGraphics: () => this.activeGraphicsId,
      getCameraMode: () => this.cameraSys.getMode(),
      getFps: () => this.currentFps,
    };

    this.clock.start();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private applyAtmosphere(presetId: AtmospherePresetId): void {
    this.activeAtmosphereId = presetId;
    const preset = ATMOSPHERE_PRESETS[presetId];
    this.sky.applyPreset(preset, this.scene, this.renderer);
    this.clouds.applyPreset(preset, this.sky.sunDirection);
    this.terrain.applyPreset(preset, this.sky.sunDirection);
  }

  private applyGraphics(gfxId: GraphicsPresetId): void {
    this.activeGraphicsId = gfxId;
    this.adaptiveDprScale = 1.0;
    const q = GRAPHICS_PRESETS[gfxId];

    this.renderer.shadowMap.enabled = q.shadowsEnabled;
    this.cameraSys.camera.far = Math.max(26000, q.drawDistance + 6000);
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
    if (this.fpsAccumTime < 1.25) return;

    this.currentFps = this.fpsFrames / this.fpsAccumTime;
    this.fpsFrames = 0;
    this.fpsAccumTime = 0;

    const q = GRAPHICS_PRESETS[this.activeGraphicsId];
    if (!q.adaptiveResolution) return;

    if (this.currentFps < 27 && this.adaptiveDprScale > 0.76) {
      this.adaptiveDprScale = Math.max(0.75, this.adaptiveDprScale - 0.1);
      this.updateRendererSize();
    } else if (this.currentFps > 54 && this.adaptiveDprScale < 1.0) {
      this.adaptiveDprScale = Math.min(1.0, this.adaptiveDprScale + 0.06);
      this.updateRendererSize();
    }
  }

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    this.updateAdaptivePerformance(dt);

    const inputs = this.input.poll();
    const inMenu = this.ui.isMenuOpen();

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
      this.ui.showToast(`Camera: ${CAMERA_LABELS[nextCam]}`);
    }

    if (!inMenu && inputs.resetAircraft && !this.physics.telemetry.crashed) {
      this.physics.recoverInAir();
      this.aircraft.resetTrails(this.physics.telemetry.position);
    }

    const preset = ATMOSPHERE_PRESETS[this.activeAtmosphereId];
    const cloudDensity = this.clouds.getCloudDensityAt(this.physics.telemetry.position);

    if (!inMenu) {
      this.physics.update(
        dt,
        inputs,
        (x, z) => this.terrain.getTerrainHeight(x, z),
        (x, z) => this.terrain.getWaterSurfaceHeight(x, z),
        (x, z) => this.terrain.classifySurface(x, z),
        cloudDensity
      );

      const h = this.physics.telemetry.haptics;
      this.input.processFlightHaptics(dt, h, this.physics.telemetry.stalling);
      if (h.touchdownIntensity > 0.05) {
        this.audio.playTouchdownSound(h.touchdownIntensity, false);
      } else if (h.scrapeIntensity > 0.05) {
        this.audio.playTouchdownSound(h.scrapeIntensity, this.physics.telemetry.surfaceType === 'water');
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
        resetAircraft: false,
        togglePause: false,
      };
      this.physics.update(
        dt * 0.75,
        showcaseIn,
        (x, z) => this.terrain.getTerrainHeight(x, z),
        (x, z) => this.terrain.getWaterSurfaceHeight(x, z),
        (x, z) => this.terrain.classifySurface(x, z),
        cloudDensity
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
      const targetFog = preset.fogDensity + cloudDensity * 0.0028;
      this.scene.fog.density += (targetFog - this.scene.fog.density) * Math.min(1, dt * 5.0);
      this.scene.fog.color.copy(preset.fogColor).lerp(preset.cloudBrightColor, cloudDensity * 0.72);
    }

    const telem = this.physics.telemetry;

    this.aircraft.update(dt, this.elapsed, telem, preset.nightLights);
    this.cameraSys.update(dt, telem, this.aircraft, inputs, inMenu && !this.flightStarted);
    this.sky.update(this.elapsed, telem.position);
    this.clouds.update(dt, this.elapsed, telem.position, cloudDensity);
    this.terrain.update(this.elapsed, telem.position);

    const gpStatus = this.gameplay.update(dt, this.elapsed, telem, this.terrain.airport, () =>
      this.audio.playUiChime(true)
    );
    this.audio.update(dt, telem, inMenu && this.flightStarted, inMenu);
    this.ui.update(telem, gpStatus, inputs.activeSource);

    this.renderer.render(this.scene, this.cameraSys.camera);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new DreamFlightApp();
});
