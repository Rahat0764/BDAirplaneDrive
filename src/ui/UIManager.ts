import { AIRCRAFT_ORDER, AIRCRAFT_SPECS } from '../aircraft/AircraftModel';
import { AudioSystem } from '../audio/AudioSystem';
import { CAMERA_LABELS, CameraSystem } from '../camera/CameraSystem';
import { InputManager } from '../controls/InputManager';
import { FlightPhysics } from '../flight/FlightPhysics';
import { GAMEPLAY_MODE_INFO, GameplayManager, GameplayStatus } from '../gameplay/GameplayManager';
import { OfflineInstaller } from '../offline/OfflineInstaller';
import {
  AircraftVariantId,
  AtmospherePresetId,
  FlightTelemetry,
  GameplayModeId,
  GraphicsPresetId,
  HudModeId,
  MenuNavActions,
  WeatherPresetId,
} from '../types';
import {
  ATMOSPHERE_ORDER,
  ATMOSPHERE_PRESETS,
  formatHourClock,
  getPhaseNameForHour,
  GRAPHICS_PRESETS,
  WEATHER_ORDER,
  WEATHER_PRESETS,
} from '../world/AtmospherePresets';
import { IconName, iconSvg } from './Icons';

type MenuTab = 'modes' | 'environment' | 'aircraft' | 'controller' | 'graphics' | 'audio';
const MENU_TABS: MenuTab[] = ['modes', 'environment', 'aircraft', 'controller', 'graphics', 'audio'];

export interface UIHooks {
  onStartFlight: (mode: GameplayModeId, specialSpawn?: 'none' | 'runway' | 'highway') => void;
  onResumeFlight: () => void;
  onSelectAircraft: (variant: AircraftVariantId) => void;
  onSelectAtmosphere: (preset: AtmospherePresetId) => void;
  onSelectWeather: (weather: WeatherPresetId) => void;
  onCycleWeather: () => void;
  onSetAutoDayNight: (enabled: boolean) => void;
  onSetManualHour: (hour: number) => void;
  onSelectGraphics: (preset: GraphicsPresetId) => void;
  getActiveAircraft: () => AircraftVariantId;
  getActiveAtmosphere: () => AtmospherePresetId;
  getActiveWeather: () => WeatherPresetId;
  isAutoDayNight: () => boolean;
  getCurrentHour: () => number;
  getActiveGraphics: () => GraphicsPresetId;
  getCurrentFps: () => number;
  onPersistSettings?: () => void;
  onResetSavedSettings?: () => void;
}

export class UIManager {
  private root: HTMLElement;
  private cloudVeilEl: HTMLElement;
  private toastStackEl!: HTMLElement;
  private bannerEl!: HTMLElement;
  private bannerTitleEl!: HTMLElement;
  private bannerSubEl!: HTMLElement;

  private menuFsFabEl!: HTMLButtonElement;
  private menuOverlayEl!: HTMLElement;
  private menuDetailEl!: HTMLElement;
  private primaryResumeBtn!: HTMLButtonElement;
  private menuInlineFsBtn!: HTMLButtonElement;
  private pwaInstallBtn!: HTMLButtonElement;

  private hudLayerEl!: HTMLElement;
  private metricsInlineEl!: HTMLElement;
  private fpsChipEl!: HTMLElement;
  private horizonReticleEl!: HTMLElement;
  private horizonLineEl!: HTMLElement;
  private actionsInlineEl!: HTMLElement;
  private hudFsBtn!: HTMLButtonElement;

  private touchWrapEl!: HTMLElement;
  private joyZoneEl!: HTMLElement;
  private joyKnobEl!: HTMLElement;
  private thrFillEl!: HTMLElement;
  private thrPctLabelEl!: HTMLElement;
  private airbrakeTouchBtn!: HTMLButtonElement;

  private activeTab: MenuTab = 'modes';
  private hudMode: HudModeId = 'minimal';
  private inMenu = true;
  private hasStartedOnce = false;
  private remapWaitingLabel: string | null = null;
  private focusedCardIdx = 0;

  constructor(
    private input: InputManager,
    private physics: FlightPhysics,
    private cameraSys: CameraSystem,
    private audio: AudioSystem,
    private gameplay: GameplayManager,
    private installer: OfflineInstaller,
    private hooks: UIHooks
  ) {
    this.root = document.getElementById('ui-root')!;
    this.cloudVeilEl = document.getElementById('cloud-veil')!;
    this.buildDom();
    this.bindTouchControls();
    this.bindFullscreenSync();
    this.renderMenuDetail();
  }

  public isMenuOpen(): boolean {
    return this.inMenu;
  }

  public openMenu(pausedFromFlight = false): void {
    this.inMenu = true;
    this.focusedCardIdx = 0;
    this.menuOverlayEl.classList.remove('hidden');
    this.menuFsFabEl.classList.remove('hidden');
    this.hudLayerEl.classList.add('hidden');
    this.primaryResumeBtn.textContent =
      pausedFromFlight || this.hasStartedOnce ? 'Resume Flight' : 'Start Flight';
    this.renderMenuDetail();
  }

  public closeMenu(): void {
    this.inMenu = false;
    this.hasStartedOnce = true;
    this.input.cancelRemapListen();
    this.remapWaitingLabel = null;
    this.menuOverlayEl.classList.add('hidden');
    this.menuFsFabEl.classList.add('hidden');
    this.hudLayerEl.classList.remove('hidden');
    this.applyHudModeLayout();
  }

  public showToast(message: string, icon?: IconName): void {
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.innerHTML = `${icon ? iconSvg(icon, 13) : ''}<span>${message}</span>`;
    this.toastStackEl.appendChild(el);
    window.setTimeout(() => el.remove(), 2900);
  }

  public getHudMode(): HudModeId { return this.hudMode; }
  public setHudMode(m: HudModeId): void { this.hudMode = m; this.applyHudModeLayout(); }

  public cycleHudMode(): void {
    this.hudMode = this.hudMode === 'minimal' ? 'immersive' : 'minimal';
    this.hooks.onPersistSettings?.();
    this.applyHudModeLayout();
    this.showToast(
      this.hudMode === 'minimal' ? 'Minimal HUD Active' : 'Immersive Pure View',
      'eye'
    );
  }

  public handleControllerMenuNav(nav: MenuNavActions): void {
    if (!this.inMenu) return;

    if (nav.back && this.hasStartedOnce) {
      this.audio.playUiChime();
      this.closeMenu();
      this.hooks.onResumeFlight();
      return;
    }

    if (nav.prevTab || nav.nextTab) {
      const idx = MENU_TABS.indexOf(this.activeTab);
      const nextIdx = (idx + (nav.nextTab ? 1 : -1) + MENU_TABS.length) % MENU_TABS.length;
      this.activeTab = MENU_TABS[nextIdx];
      this.focusedCardIdx = 0;
      this.audio.playUiChime();
      document.querySelectorAll('.nav-tab-btn').forEach((b) => {
        b.classList.toggle('active', (b as HTMLElement).dataset.tab === this.activeTab);
      });
      this.renderMenuDetail();
      this.highlightMenuFocus();
      return;
    }

    const focusables = this.getMenuFocusables();
    if (focusables.length === 0) return;

    if (nav.down || nav.right) {
      this.focusedCardIdx = (this.focusedCardIdx + 1) % focusables.length;
      this.audio.playUiChime();
      this.highlightMenuFocus();
    } else if (nav.up || nav.left) {
      this.focusedCardIdx = (this.focusedCardIdx - 1 + focusables.length) % focusables.length;
      this.audio.playUiChime();
      this.highlightMenuFocus();
    } else if (nav.confirm) {
      const target = focusables[this.focusedCardIdx];
      if (target) {
        this.audio.unlockAndStart();
        target.click();
      }
    }
  }

  private getMenuFocusables(): HTMLElement[] {
    return Array.from(
      this.menuDetailEl.querySelectorAll<HTMLElement>('.choice-card, .pill-btn')
    );
  }

  private highlightMenuFocus(): void {
    const list = this.getMenuFocusables();
    list.forEach((el, i) => {
      const active = i === this.focusedCardIdx;
      el.classList.toggle('gp-focus', active);
      if (active) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  private applyHudModeLayout(): void {
    if (this.hudMode === 'minimal') {
      this.metricsInlineEl.style.visibility = 'visible';
      this.horizonReticleEl.style.display = 'block';
      this.actionsInlineEl.style.opacity = '1';
    } else {
      this.metricsInlineEl.style.visibility = 'hidden';
      this.horizonReticleEl.style.display = 'none';
      this.actionsInlineEl.style.opacity = '0.42';
    }
  }

  public async enterOrToggleFullscreenLandscape(forceEnterOnly = false): Promise<void> {
    const doc = document as Document & {
      webkitFullscreenElement?: Element;
      webkitExitFullscreen?: () => Promise<void>;
    };
    const docEl = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };

    const isFs = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);

    if (isFs && !forceEnterOnly) {
      if (document.exitFullscreen) {
        await document.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen().catch(() => {});
      }
      return;
    }

    try {
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen({ navigationUI: 'hide' });
      } else if (docEl.webkitRequestFullscreen) {
        await docEl.webkitRequestFullscreen();
      }
    } catch {
      // Ignore
    }

    try {
      const scr = screen as unknown as {
        orientation?: { lock?: (mode: string) => Promise<void> };
      };
      if (scr.orientation?.lock) {
        await scr.orientation
          .lock('landscape')
          .catch(() => scr.orientation?.lock?.('landscape-primary'));
      }
    } catch {
      // Ignore
    }
  }

  private bindFullscreenSync(): void {
    const syncLabels = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element };
      const isFs = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
      this.menuFsFabEl.innerHTML = isFs
        ? `${iconSvg('exit-fullscreen', 14)}<span>Exit Full Screen</span>`
        : `${iconSvg('fullscreen', 14)}<span>Full Screen</span>`;
      this.menuInlineFsBtn.innerHTML = isFs
        ? `${iconSvg('exit-fullscreen', 14)}<span>Exit</span>`
        : `${iconSvg('fullscreen', 14)}<span>Full</span>`;
      this.hudFsBtn.innerHTML = isFs
        ? iconSvg('exit-fullscreen', 14)
        : iconSvg('fullscreen', 14);
    };
    document.addEventListener('fullscreenchange', syncLabels);
    document.addEventListener('webkitfullscreenchange', syncLabels);
  }

  private buildDom(): void {
    this.root.innerHTML = `
      <div class="toast-stack" id="toast-stack"></div>

      <div class="vista-banner hidden" id="vista-banner">
        <h3 id="vista-title"></h3>
        <p id="vista-sub"></p>
      </div>

      <button class="menu-fs-fab" id="btn-menu-fs-fab">
        ${iconSvg('fullscreen', 14)}<span>Full Screen</span>
      </button>

      <!-- Main Menu / Pause Overlay -->
      <div class="menu-overlay" id="menu-overlay">
        <div class="menu-sidebar">
          <div>
            <div class="brand-eyebrow">GHIBLI-SUNLIT 3D AVIATION</div>
            <h1 class="brand-title">DREAM FLIGHT</h1>
            <p class="brand-subtitle">
              Soar through painterly cumulus cathedrals, sparkling open seas, scenic valley highways &amp; real-time skies.
            </p>
          </div>

          <div class="cta-row">
            <button class="primary-btn" id="btn-start-resume">Start Flight</button>
            <button class="fs-cta-btn" id="btn-menu-fs-inline" title="Full Screen Landscape">
              ${iconSvg('fullscreen', 14)}<span>Full</span>
            </button>
          </div>

          <div class="offline-status-row">
            <span class="offline-pill" id="offline-status-pill">
              ${iconSvg('check', 12)}<span>Saved Locally</span>
            </span>
            <button class="pill-btn hidden" id="btn-pwa-install">
              ${iconSvg('download', 12)}<span>Install App</span>
            </button>
          </div>

          <div class="menu-nav-grid" id="menu-tabs">
            <button class="nav-tab-btn active" data-tab="modes">${iconSvg('plane', 13)}<span>Flight &amp; Roads</span></button>
            <button class="nav-tab-btn" data-tab="environment">${iconSvg('cloud-sun', 13)}<span>Sky &amp; Weather</span></button>
            <button class="nav-tab-btn" data-tab="aircraft">${iconSvg('sliders', 13)}<span>Aircraft</span></button>
            <button class="nav-tab-btn" data-tab="controller">${iconSvg('gamepad', 13)}<span>Controller</span></button>
            <button class="nav-tab-btn" data-tab="graphics">${iconSvg('eye', 13)}<span>Graphics</span></button>
            <button class="nav-tab-btn" data-tab="audio">${iconSvg('volume', 13)}<span>Audio</span></button>
          </div>
        </div>

        <div class="menu-detail-panel" id="menu-detail"></div>
      </div>

      <!-- ULTRA-CLEAN SINGLE-LINE ELEGANT HUD -->
      <div class="hud-layer hidden" id="hud-layer">
        <div class="hud-single-line">
          <div class="hud-left-group">
            <div class="hud-metrics-inline" id="hud-metrics-inline">
              <span id="hud-txt-line">112 KT · 1,770 FT · 360 N · THR 68%</span>
            </div>
            <div class="hud-fps-chip" id="hud-fps-chip" title="Live Frame Rate">
              <span class="fps-dot" id="hud-fps-dot"></span>
              <span id="hud-fps-val">60 FPS</span>
            </div>
          </div>

          <div class="hud-actions-inline" id="hud-actions-inline">
            <button class="hud-icon-btn" id="btn-hud-cam" title="Switch Camera">${iconSvg('camera', 14)}<span class="control-hint" data-hint-action="camera">C</span></button>
            <button class="hud-icon-btn" id="btn-hud-weather" title="Cycle Weather">${iconSvg('cloud-sun', 14)}<span class="control-hint" data-hint-action="weather">V</span></button>
            <button class="hud-icon-btn" id="btn-hud-gear" title="Landing Gear">${iconSvg('gear', 14)}<span id="hud-gear-txt">DN</span><span class="control-hint" data-hint-action="gear">G</span></button>
            <button class="hud-icon-btn hud-hide-narrow" id="btn-hud-sky" title="Cycle Time of Day">${iconSvg('clock', 14)}<span class="control-hint" data-hint-action="time">T</span></button>
            <button class="hud-icon-btn hud-hide-narrow" id="btn-hud-zoom" title="Camera Distance">${iconSvg('zoom', 14)}<span class="control-hint" data-hint-action="zoom">Z</span></button>
            <button class="hud-icon-btn" id="btn-hud-mode" title="Toggle Pure View">${iconSvg('eye', 14)}<span class="control-hint" data-hint-action="hud">H</span></button>
            <button class="hud-icon-btn hud-hide-narrow" id="btn-hud-reset" title="Stabilize Plane">${iconSvg('reset', 14)}<span class="control-hint" data-hint-action="reset">⌫</span></button>
            <button class="hud-icon-btn highlight-fs" id="btn-hud-fs" title="Full Screen">${iconSvg('fullscreen', 14)}</button>
            <button class="hud-icon-btn" id="btn-hud-pause" title="Menu">${iconSvg('menu', 14)}<span class="control-hint" data-hint-action="pause">P</span></button>
          </div>
        </div>

        <div class="horizon-reticle" id="horizon-reticle">
          <div class="horizon-line" id="horizon-line"></div>
          <div class="horizon-aircraft-wing"></div>
        </div>

        <!-- Ergonomic Mobile / Landscape Touch Controls -->
        <div class="touch-controls-wrap" id="touch-wrap">
          <div class="touch-left-cluster">
            <div class="touch-joystick-zone" id="joy-zone">
              <div class="joy-cross-h"></div>
              <div class="joy-cross-v"></div>
              <div class="touch-joystick-knob" id="joy-knob"></div>
            </div>
            <div class="touch-rudder-row">
              <button class="touch-mini-btn" id="btn-touch-yaw-l">YAW L</button>
              <button class="touch-mini-btn" id="btn-touch-yaw-r">YAW R</button>
            </div>
          </div>

          <div class="touch-right-cluster">
            <div class="touch-action-col">
              <button class="touch-circle-btn" id="btn-touch-cam" title="Camera">${iconSvg('camera', 15)}<span class="control-hint" data-hint-action="camera">C</span></button>
              <button class="touch-circle-btn" id="btn-touch-weather" title="Weather">${iconSvg('cloud-sun', 15)}<span class="control-hint" data-hint-action="weather">V</span></button>
              <button class="touch-airbrake-btn" id="btn-touch-brake">BRK<span class="control-hint" data-hint-action="airbrake">Spc</span></button>
            </div>
            <div class="touch-throttle-track" id="thr-track">
              <div class="touch-throttle-fill" id="thr-fill"></div>
              <div class="touch-throttle-ticks">
                <span></span><span></span><span></span>
              </div>
              <div class="touch-throttle-label">
                <span>MAX</span>
                <span id="thr-pct-lbl">68%</span>
                <span>IDLE</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.toastStackEl = document.getElementById('toast-stack')!;
    this.bannerEl = document.getElementById('vista-banner')!;
    this.bannerTitleEl = document.getElementById('vista-title')!;
    this.bannerSubEl = document.getElementById('vista-sub')!;

    this.menuFsFabEl = document.getElementById('btn-menu-fs-fab') as HTMLButtonElement;
    this.menuOverlayEl = document.getElementById('menu-overlay')!;
    this.menuDetailEl = document.getElementById('menu-detail')!;
    this.primaryResumeBtn = document.getElementById('btn-start-resume') as HTMLButtonElement;
    this.menuInlineFsBtn = document.getElementById('btn-menu-fs-inline') as HTMLButtonElement;
    this.pwaInstallBtn = document.getElementById('btn-pwa-install') as HTMLButtonElement;

    this.hudLayerEl = document.getElementById('hud-layer')!;
    this.metricsInlineEl = document.getElementById('hud-metrics-inline')!;
    this.fpsChipEl = document.getElementById('hud-fps-chip')!;
    this.horizonReticleEl = document.getElementById('horizon-reticle')!;
    this.horizonLineEl = document.getElementById('horizon-line')!;
    this.actionsInlineEl = document.getElementById('hud-actions-inline')!;
    this.hudFsBtn = document.getElementById('btn-hud-fs') as HTMLButtonElement;

    this.touchWrapEl = document.getElementById('touch-wrap')!;
    this.joyZoneEl = document.getElementById('joy-zone')!;
    this.joyKnobEl = document.getElementById('joy-knob')!;
    this.thrFillEl = document.getElementById('thr-fill')!;
    this.thrPctLabelEl = document.getElementById('thr-pct-lbl')!;
    this.airbrakeTouchBtn = document.getElementById('btn-touch-brake') as HTMLButtonElement;

    const handleFsClick = () => {
      this.audio.unlockAndStart();
      this.audio.playUiChime(true);
      this.enterOrToggleFullscreenLandscape(false);
    };
    this.menuFsFabEl.addEventListener('click', handleFsClick);
    this.menuInlineFsBtn.addEventListener('click', handleFsClick);
    this.hudFsBtn.addEventListener('click', handleFsClick);

    this.pwaInstallBtn.addEventListener('click', async () => {
      const ok = await this.installer.promptPwaInstall();
      if (ok) {
        this.showToast('App installed for offline flight', 'check');
        this.pwaInstallBtn.classList.add('hidden');
      }
    });

    this.primaryResumeBtn.addEventListener('click', () => {
      this.audio.unlockAndStart();
      this.audio.playUiChime(true);
      if (this.hasStartedOnce) {
        this.closeMenu();
        this.hooks.onResumeFlight();
      } else {
        this.closeMenu();
        this.hooks.onStartFlight(this.gameplay.getMode(), 'none');
      }
    });

    document.getElementById('menu-tabs')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.nav-tab-btn') as HTMLButtonElement | null;
      if (!btn) return;
      this.audio.unlockAndStart();
      this.audio.playUiChime();
      this.activeTab = btn.dataset.tab as MenuTab;
      this.focusedCardIdx = 0;
      document.querySelectorAll('.nav-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      this.renderMenuDetail();
    });

    document.getElementById('btn-hud-pause')!.addEventListener('click', () => {
      this.audio.playUiChime();
      this.openMenu(true);
    });

    document.getElementById('btn-hud-cam')!.addEventListener('click', () => {
      this.audio.playUiChime();
      const next = this.cameraSys.cycleMode();
      this.showToast(`Camera: ${CAMERA_LABELS[next]}`, 'camera');
    });

    document.getElementById('btn-hud-weather')!.addEventListener('click', () => {
      this.audio.playUiChime();
      this.hooks.onCycleWeather();
    });

    document.getElementById('btn-hud-gear')!.addEventListener('click', () => {
      this.audio.playUiChime();
      this.input.triggerUiAction('toggleGear');
    });

    document.getElementById('btn-hud-sky')!.addEventListener('click', () => {
      this.audio.playUiChime();
      this.input.triggerUiAction('cycleTime');
    });

    document.getElementById('btn-hud-zoom')!.addEventListener('click', () => {
      this.audio.playUiChime();
      const label = this.cameraSys.cycleZoomPreset();
      this.showToast(`Camera Distance: ${label}`, 'zoom');
    });

    document.getElementById('btn-hud-mode')!.addEventListener('click', () => {
      this.audio.playUiChime();
      this.cycleHudMode();
    });

    document.getElementById('btn-hud-reset')!.addEventListener('click', () => {
      this.audio.playUiChime();
      this.input.triggerUiAction('resetAircraft');
      this.showToast('Aircraft stabilized in sky', 'reset');
    });
  }

  private bindTouchControls(): void {
    let joyPointerId: number | null = null;
    const maxRadius = 52;

    const updateStick = (clientX: number, clientY: number) => {
      const rect = this.joyZoneEl.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }
      this.joyKnobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.input.touchStickX = dx / maxRadius;
      this.input.touchStickY = dy / maxRadius;
      this.input.notifyTouchUsed();
    };

    this.joyZoneEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.audio.unlockAndStart();
      joyPointerId = e.pointerId;
      this.joyZoneEl.setPointerCapture(e.pointerId);
      this.joyZoneEl.classList.add('active');
      updateStick(e.clientX, e.clientY);
    });

    this.joyZoneEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyPointerId) return;
      e.stopPropagation();
      updateStick(e.clientX, e.clientY);
    });

    const resetStick = (e: PointerEvent) => {
      if (e.pointerId !== joyPointerId) return;
      joyPointerId = null;
      this.joyZoneEl.classList.remove('active');
      this.joyKnobEl.style.transform = 'translate(-50%, -50%)';
      this.input.touchStickX = 0;
      this.input.touchStickY = 0;
    };
    this.joyZoneEl.addEventListener('pointerup', resetStick);
    this.joyZoneEl.addEventListener('pointercancel', resetStick);

    // Dedicated Touch Rudder (Yaw L / Yaw R)
    const bindHoldYaw = (btnId: string, dir: number) => {
      const btn = document.getElementById(btnId)!;
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.audio.unlockAndStart();
        this.input.touchYaw = dir;
        this.input.notifyTouchUsed();
        btn.classList.add('active');
      });
      const release = () => {
        if (this.input.touchYaw === dir) this.input.touchYaw = 0;
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    };
    bindHoldYaw('btn-touch-yaw-l', -0.85);
    bindHoldYaw('btn-touch-yaw-r', 0.85);

    // Quick-access right-thumb camera & weather buttons
    document.getElementById('btn-touch-cam')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.audio.playUiChime();
      const next = this.cameraSys.cycleMode();
      this.showToast(`Camera: ${CAMERA_LABELS[next]}`, 'camera');
    });
    document.getElementById('btn-touch-weather')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.audio.playUiChime();
      this.hooks.onCycleWeather();
    });

    // Smooth vertical throttle track
    const thrTrack = document.getElementById('thr-track')!;
    let thrPointerId: number | null = null;

    const updateThrottleFromY = (clientY: number) => {
      const rect = thrTrack.getBoundingClientRect();
      const pct = 1.0 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      this.input.touchThrottleDirect = pct;
      this.input.notifyTouchUsed();
    };

    thrTrack.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.audio.unlockAndStart();
      thrPointerId = e.pointerId;
      thrTrack.setPointerCapture(e.pointerId);
      updateThrottleFromY(e.clientY);
    });

    thrTrack.addEventListener('pointermove', (e) => {
      if (e.pointerId !== thrPointerId) return;
      e.stopPropagation();
      updateThrottleFromY(e.clientY);
    });

    const endThr = (e: PointerEvent) => {
      if (e.pointerId === thrPointerId) thrPointerId = null;
    };
    thrTrack.addEventListener('pointerup', endThr);
    thrTrack.addEventListener('pointercancel', endThr);

    this.airbrakeTouchBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.input.touchAirbrake = true;
      this.input.notifyTouchUsed();
      this.airbrakeTouchBtn.classList.add('active');
    });
    const releaseBrake = () => {
      this.input.touchAirbrake = false;
      this.airbrakeTouchBtn.classList.remove('active');
    };
    this.airbrakeTouchBtn.addEventListener('pointerup', releaseBrake);
    this.airbrakeTouchBtn.addEventListener('pointercancel', releaseBrake);
    this.airbrakeTouchBtn.addEventListener('pointerleave', releaseBrake);
  }

  public renderMenuDetail(): void {
    const assist = this.physics.getAssistOptions();
    this.pwaInstallBtn.classList.toggle('hidden', !this.installer.canPromptPwaInstall());

    if (this.activeTab === 'modes') {
      const curMode = this.gameplay.getMode();
      const modeCards = (Object.keys(GAMEPLAY_MODE_INFO) as GameplayModeId[])
        .map((m) => {
          const info = GAMEPLAY_MODE_INFO[m];
          return `
            <div class="choice-card ${curMode === m ? 'selected' : ''}" data-launch-mode="${m}">
              <h4>${info.title}</h4>
              <p>${info.subtitle}</p>
            </div>
          `;
        })
        .join('');

      this.menuDetailEl.innerHTML = `
        <div class="panel-title">Flight Modes, Airport &amp; Open Sea</div>
        <div class="panel-desc">Explore sunlit valleys, hydroplane across the open sea, or touch down on Dream Valley Runway 36 &amp; the 7.4 km Scenic Highway.</div>
        <div class="card-list">${modeCards}</div>

        <div style="margin-top:11px; display:flex; flex-wrap:wrap; gap:8px;">
          <button class="pill-btn" id="btn-runway-takeoff">${iconSvg('runway', 13)}<span>Takeoff Runway 36</span></button>
          <button class="pill-btn" id="btn-highway-approach">${iconSvg('road', 13)}<span>Approach Scenic Highway</span></button>
        </div>

        <div style="margin-top:14px;" class="panel-title">Flight Physics</div>
        <div class="setting-row">
          <span>Flight Mode</span>
          <div style="display:flex; gap:6px;">
            <button class="pill-btn ${assist.flightMode === 'relaxed' ? 'active' : ''}" data-fmode="relaxed">Relaxed</button>
            <button class="pill-btn ${assist.flightMode === 'simulation' ? 'active' : ''}" data-fmode="simulation">Simulation</button>
          </div>
        </div>
        <div class="setting-row">
          <span>Altitude Hold Assist</span>
          <button class="pill-btn ${assist.altitudeAssist ? 'active' : ''}" id="toggle-alt-assist">${assist.altitudeAssist ? 'ON' : 'OFF'}</button>
        </div>
        <div class="setting-row">
          <span>Stall Simulation</span>
          <button class="pill-btn ${assist.stallSimulation ? 'active' : ''}" id="toggle-stall">${assist.stallSimulation ? 'ON' : 'OFF'}</button>
        </div>
        <div class="setting-row">
          <span>Collision Crash Reset</span>
          <button class="pill-btn ${assist.collisionDamage ? 'active' : ''}" id="toggle-crash">${assist.collisionDamage ? 'ON' : 'OFF'}</button>
        </div>
      `;

      this.menuDetailEl.querySelectorAll('[data-launch-mode]').forEach((el) => {
        el.addEventListener('click', () => {
          const m = (el as HTMLElement).dataset.launchMode as GameplayModeId;
          this.audio.unlockAndStart();
          this.audio.playUiChime(true);
          this.closeMenu();
          this.hooks.onStartFlight(m, 'none');
        });
      });

      document.getElementById('btn-runway-takeoff')?.addEventListener('click', () => {
        this.audio.unlockAndStart();
        this.audio.playUiChime(true);
        this.closeMenu();
        this.hooks.onStartFlight('free_flight', 'runway');
      });

      document.getElementById('btn-highway-approach')?.addEventListener('click', () => {
        this.audio.unlockAndStart();
        this.audio.playUiChime(true);
        this.closeMenu();
        this.hooks.onStartFlight('free_flight', 'highway');
      });

      this.menuDetailEl.querySelectorAll('[data-fmode]').forEach((el) => {
        el.addEventListener('click', () => {
          const fm = (el as HTMLElement).dataset.fmode as 'relaxed' | 'simulation';
          this.physics.setAssistOptions({ flightMode: fm }); this.hooks.onPersistSettings?.();
          this.renderMenuDetail();
        });
      });

      document.getElementById('toggle-alt-assist')?.addEventListener('click', () => {
        this.physics.setAssistOptions({ altitudeAssist: !assist.altitudeAssist }); this.hooks.onPersistSettings?.();
        this.renderMenuDetail();
      });
      document.getElementById('toggle-stall')?.addEventListener('click', () => {
        this.physics.setAssistOptions({ stallSimulation: !assist.stallSimulation }); this.hooks.onPersistSettings?.();
        this.renderMenuDetail();
      });
      document.getElementById('toggle-crash')?.addEventListener('click', () => {
        this.physics.setAssistOptions({ collisionDamage: !assist.collisionDamage }); this.hooks.onPersistSettings?.();
        this.renderMenuDetail();
      });
      return;
    }

    if (this.activeTab === 'environment') {
      const autoTime = this.hooks.isAutoDayNight();
      const curHour = this.hooks.getCurrentHour();
      const curAtm = this.hooks.getActiveAtmosphere();
      const curWeather = this.hooks.getActiveWeather();

      const weatherCards = WEATHER_ORDER.map((id) => {
        const w = WEATHER_PRESETS[id];
        return `
          <div class="choice-card ${curWeather === id ? 'selected' : ''}" data-weather="${id}">
            <h4 class="card-title-row">${iconSvg(w.icon as IconName, 14)}<span>${w.name}</span></h4>
            <p>${w.subtitle}</p>
          </div>
        `;
      }).join('');

      const timeCards = ATMOSPHERE_ORDER.map((id) => {
        const p = ATMOSPHERE_PRESETS[id];
        return `
          <div class="choice-card ${!autoTime && curAtm === id ? 'selected' : ''}" data-atm="${id}">
            <h4>${p.name}</h4>
            <p>${p.subtitle}</p>
          </div>
        `;
      }).join('');

      this.menuDetailEl.innerHTML = `
        <div class="panel-title">Real-Time Day-Night Cycle &amp; Weather</div>
        <div class="panel-desc">Automatically tracks your local real-world clock, or switch manually anytime. Press R1 on controller to change weather live.</div>

        <div class="setting-row">
          <span>${iconSvg('clock', 13)} Auto Real-Time Sky (${formatHourClock(curHour)} · ${getPhaseNameForHour(curHour)})</span>
          <button class="pill-btn ${autoTime ? 'active' : ''}" id="btn-auto-time">${autoTime ? 'AUTO ON' : 'MANUAL'}</button>
        </div>

        <div class="setting-row">
          <span>Manual Time Slider (${formatHourClock(curHour)})</span>
          <input type="range" id="rng-time-hour" min="0" max="23.95" step="0.1" value="${curHour.toFixed(2)}" />
        </div>

        <div style="margin-top:12px;" class="panel-title">Weather Conditions (R1)</div>
        <div class="card-list">${weatherCards}</div>

        <div style="margin-top:14px;" class="panel-title">Quick Time Presets</div>
        <div class="card-list">${timeCards}</div>
      `;

      document.getElementById('btn-auto-time')?.addEventListener('click', () => {
        this.audio.playUiChime();
        this.hooks.onSetAutoDayNight(!autoTime);
        this.renderMenuDetail();
      });

      document.getElementById('rng-time-hour')?.addEventListener('input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        this.hooks.onSetManualHour(val);
      });

      this.menuDetailEl.querySelectorAll('[data-weather]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = (el as HTMLElement).dataset.weather as WeatherPresetId;
          this.audio.playUiChime();
          this.hooks.onSelectWeather(id);
          this.renderMenuDetail();
        });
      });

      this.menuDetailEl.querySelectorAll('[data-atm]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = (el as HTMLElement).dataset.atm as AtmospherePresetId;
          this.audio.playUiChime();
          this.hooks.onSelectAtmosphere(id);
          this.renderMenuDetail();
        });
      });
      return;
    }

    if (this.activeTab === 'aircraft') {
      const curAc = this.hooks.getActiveAircraft();
      const cards = AIRCRAFT_ORDER.map((id) => {
        const s = AIRCRAFT_SPECS[id];
        return `
          <div class="choice-card ${curAc === id ? 'selected' : ''}" data-ac="${id}">
            <h4>${s.name}</h4>
            <p><strong>${s.subtitle}</strong> — Cruise ${s.cruiseSpeedKts} kts · Span ${s.wingSpan}m. ${s.description}</p>
          </div>
        `;
      }).join('');

      this.menuDetailEl.innerHTML = `
        <div class="panel-title">Light Aircraft Hangar</div>
        <div class="panel-desc">Detailed airframes with metallic panel rivets, animated control surfaces, pilot scarf &amp; 3D water spray wakes.</div>
        <div class="card-list">${cards}</div>
      `;

      this.menuDetailEl.querySelectorAll('[data-ac]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = (el as HTMLElement).dataset.ac as AircraftVariantId;
          this.audio.playUiChime(true);
          this.hooks.onSelectAircraft(id);
          this.renderMenuDetail();
          this.showToast(`Selected ${AIRCRAFT_SPECS[id].name}`, 'plane');
        });
      });
      return;
    }

    if (this.activeTab === 'graphics') {
      const curGfx = this.hooks.getActiveGraphics();
      const cards = (['low', 'medium', 'high', 'ultra'] as GraphicsPresetId[])
        .map((id) => {
          const g = GRAPHICS_PRESETS[id];
          return `
            <div class="choice-card ${curGfx === id ? 'selected' : ''}" data-gfx="${id}">
              <h4>${g.label}</h4>
              <p>Clouds: ${g.cloudClusterCount} castles · Max DPR: ${g.maxDpr}x · Shadows: ${g.shadowMapSize}px</p>
            </div>
          `;
        })
        .join('');

      this.menuDetailEl.innerHTML = `
        <div class="panel-title">Graphics &amp; Performance</div>
        <div class="panel-desc">Live Frame Rate: <strong>${Math.round(this.hooks.getCurrentFps())} FPS</strong>. All files run from local browser storage for zero network lag.</div>
        <div class="card-list">${cards}</div>
        <div style="margin-top:14px;" class="panel-title">Saved Settings</div>
        <div class="panel-desc">Flight mode, graphics, aircraft, weather, time, HUD &amp; audio are remembered between visits.</div>
        <button class="pill-btn" id="btn-reset-saved-settings">${iconSvg('reset', 12)}<span>Reset saved settings</span></button>
      `;
      document.getElementById('btn-reset-saved-settings')?.addEventListener('click', () => {
        this.hooks.onResetSavedSettings?.();
        this.showToast('Saved settings cleared', 'reset');
        this.renderMenuDetail();
      });

      this.menuDetailEl.querySelectorAll('[data-gfx]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = (el as HTMLElement).dataset.gfx as GraphicsPresetId;
          this.audio.playUiChime();
          this.hooks.onSelectGraphics(id);
          this.renderMenuDetail();
        });
      });
      return;
    }

    if (this.activeTab === 'controller') {
      const s = this.input.settings;
      const m = s.mapping;
      const snap = this.input.getLiveGamepadSnapshot();

      this.menuDetailEl.innerHTML = `
        <div class="panel-title">Controller &amp; Full Hands-Free Mapping</div>
        <div class="panel-desc">
          L1 Camera · R1 Weather · R2/L2 Throttle · Triangle/Y Time · Cross/A Gear · Square/X Brake · Circle/B Reset · R3 Zoom · D-Pad Aircraft/HUD.
        </div>

        <div class="gp-tester-box">
          <div style="font-size:12px; font-weight:600; color:${snap.connected ? '#6ee7b7' : '#fda4af'};" id="gp-live-status">
            ${snap.connected ? `Connected: ${snap.profileLabel}` : 'No Gamepad Active — Press any controller button'}
          </div>
          <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">${snap.compatibilityNote}</div>
          <div class="gp-sticks-row">
            <div><div class="stick-viz"><div class="stick-dot" id="gp-dot-left"></div></div></div>
            <div><div class="stick-viz"><div class="stick-dot" id="gp-dot-right"></div></div></div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              <button class="pill-btn" id="btn-gp-vib-test">${iconSvg('vibrate', 12)}<span>Test Rumble</span></button>
              <button class="pill-btn" id="btn-gp-calibrate">Calibrate Sticks</button>
              <button class="pill-btn" id="btn-gp-reset">Reset Defaults</button>
            </div>
          </div>
          <div class="gp-buttons-grid" id="gp-buttons-grid"></div>
        </div>

        <div class="setting-row">
          <span>Touchdown &amp; Water Rumble</span>
          <button class="pill-btn ${s.vibrationEnabled ? 'active' : ''}" id="btn-vib-toggle">${s.vibrationEnabled ? 'ON' : 'OFF'}</button>
        </div>
        <div class="setting-row">
          <span>Stick Sensitivity (${s.sensitivity.toFixed(2)}x)</span>
          <input type="range" id="rng-sens" min="0.4" max="1.8" step="0.05" value="${s.sensitivity}" />
        </div>
        <div class="setting-row">
          <span>Analog Deadzone (${Math.round(s.deadzone * 100)}%)</span>
          <input type="range" id="rng-dz" min="0.02" max="0.35" step="0.02" value="${s.deadzone}" />
        </div>
        <div class="setting-row">
          <span>Invert Pitch Axis</span>
          <button class="pill-btn ${s.invertPitch ? 'active' : ''}" id="btn-inv-pitch">${s.invertPitch ? 'Inverted' : 'Standard'}</button>
        </div>

        <div style="margin-top:8px; font-size:11.5px; color:var(--accent-gold);">
          ${this.remapWaitingLabel ? `Press button/axis on controller for: <strong>${this.remapWaitingLabel}</strong>...` : 'Custom Mapping (Tap to Remap):'}
        </div>
        <div class="setting-row"><span>Camera (L1/LB)</span><button class="pill-btn" data-remap-btn="cameraBtn">Btn ${m.cameraBtn}</button></div>
        <div class="setting-row"><span>Weather (R1/RB)</span><button class="pill-btn" data-remap-btn="weatherBtn">Btn ${m.weatherBtn}</button></div>
        <div class="setting-row"><span>Time of Day (Triangle/Y)</span><button class="pill-btn" data-remap-btn="timeBtn">Btn ${m.timeBtn}</button></div>
        <div class="setting-row"><span>Throttle Up (R2/RT)</span><button class="pill-btn" data-remap-btn="throttleUpBtn">Btn ${m.throttleUpBtn}</button></div>
        <div class="setting-row"><span>Throttle Down (L2/LT)</span><button class="pill-btn" data-remap-btn="throttleDownBtn">Btn ${m.throttleDownBtn}</button></div>
        <div class="setting-row"><span>Landing Gear (Cross/A)</span><button class="pill-btn" data-remap-btn="gearBtn">Btn ${m.gearBtn}</button></div>
        <div class="setting-row"><span>Air Brakes (Square/X)</span><button class="pill-btn" data-remap-btn="airbrakeBtn">Btn ${m.airbrakeBtn}</button></div>
        <div class="setting-row"><span>Reset Plane (Circle/B)</span><button class="pill-btn" data-remap-btn="resetBtn">Btn ${m.resetBtn}</button></div>
        <div class="setting-row"><span>Camera Zoom (R3)</span><button class="pill-btn" data-remap-btn="zoomBtn">Btn ${m.zoomBtn}</button></div>
      `;

      document.getElementById('btn-gp-vib-test')?.addEventListener('click', () => {
        this.input.triggerVibration(260, 0.85, 0.65, true);
        this.showToast('Sent haptic rumble pulse', 'vibrate');
      });
      document.getElementById('btn-vib-toggle')?.addEventListener('click', () => {
        s.vibrationEnabled = !s.vibrationEnabled;
        this.input.saveSettings();
        this.renderMenuDetail();
      });
      document.getElementById('rng-sens')?.addEventListener('input', (e) => {
        s.sensitivity = parseFloat((e.target as HTMLInputElement).value);
        this.input.saveSettings();
      });
      document.getElementById('rng-dz')?.addEventListener('input', (e) => {
        s.deadzone = parseFloat((e.target as HTMLInputElement).value);
        this.input.saveSettings();
      });
      document.getElementById('btn-inv-pitch')?.addEventListener('click', () => {
        s.invertPitch = !s.invertPitch;
        this.input.saveSettings();
        this.renderMenuDetail();
      });
      document.getElementById('btn-gp-calibrate')?.addEventListener('click', () => {
        const ok = this.input.calibrateGamepadCenters();
        this.showToast(ok ? 'Analog sticks calibrated' : 'Connect a gamepad first', 'gamepad');
      });
      document.getElementById('btn-gp-reset')?.addEventListener('click', () => {
        this.input.resetControllerDefaults();
        this.showToast('Controller defaults restored', 'reset');
        this.renderMenuDetail();
      });

      this.menuDetailEl.querySelectorAll('[data-remap-btn]').forEach((el) => {
        el.addEventListener('click', () => {
          const key = (el as HTMLElement).dataset.remapBtn as keyof typeof m;
          this.remapWaitingLabel = key;
          this.renderMenuDetail();
          this.input.listenForNextGamepadInput('button', (_k, idx) => {
            m[key] = idx;
            this.input.saveSettings();
            this.remapWaitingLabel = null;
            this.renderMenuDetail();
          });
        });
      });
      return;
    }

    if (this.activeTab === 'audio') {
      const a = this.audio.settings;
      this.menuDetailEl.innerHTML = `
        <div class="panel-title">Peaceful Audio &amp; Ambient Music</div>
        <div class="panel-desc">Gentle aircraft engine hum, high-altitude wind, water splash &amp; original generative music.</div>

        <div class="setting-row">
          <span>Master Audio</span>
          <button class="pill-btn ${a.masterEnabled ? 'active' : ''}" id="btn-aud-master">${a.masterEnabled ? 'Enabled' : 'Muted'}</button>
        </div>
        <div class="setting-row">
          <span>Engine Volume (${Math.round(a.engineVolume * 100)}%)</span>
          <input type="range" id="rng-eng" min="0" max="1" step="0.02" value="${a.engineVolume}" />
        </div>
        <div class="setting-row">
          <span>Wind &amp; Sky Ambience (${Math.round(a.ambientVolume * 100)}%)</span>
          <input type="range" id="rng-amb" min="0" max="1" step="0.02" value="${a.ambientVolume}" />
        </div>
        <div class="setting-row">
          <span>Ambient Music (${Math.round(a.musicVolume * 100)}%)</span>
          <input type="range" id="rng-mus" min="0" max="1" step="0.02" value="${a.musicVolume}" />
        </div>
        <div class="setting-row">
          <span>Mute Music Only</span>
          <button class="pill-btn ${a.musicMuted ? 'active' : ''}" id="btn-mus-mute">${a.musicMuted ? 'Music Muted' : 'Playing'}</button>
        </div>
      `;

      document.getElementById('btn-aud-master')?.addEventListener('click', () => {
        this.audio.unlockAndStart();
        a.masterEnabled = !a.masterEnabled;
        this.audio.saveSettings();
        this.renderMenuDetail();
      });
      document.getElementById('btn-mus-mute')?.addEventListener('click', () => {
        this.audio.unlockAndStart();
        a.musicMuted = !a.musicMuted;
        this.audio.saveSettings();
        this.renderMenuDetail();
      });
      document.getElementById('rng-eng')?.addEventListener('input', (e) => {
        this.audio.unlockAndStart();
        a.engineVolume = parseFloat((e.target as HTMLInputElement).value);
        this.audio.saveSettings();
      });
      document.getElementById('rng-amb')?.addEventListener('input', (e) => {
        this.audio.unlockAndStart();
        a.ambientVolume = parseFloat((e.target as HTMLInputElement).value);
        this.audio.saveSettings();
      });
      document.getElementById('rng-mus')?.addEventListener('input', (e) => {
        this.audio.unlockAndStart();
        a.musicVolume = parseFloat((e.target as HTMLInputElement).value);
        this.audio.saveSettings();
      });
    }
  }

  private cardinalFromHeading(deg: number): string {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(deg / 45) % 8];
  }

  private lastHintMode = '';
  public update(telemetry: FlightTelemetry, gpStatus: GameplayStatus, activeControlSource: string): void {
    // v3 control hints: badge shows gamepad glyph when a pad is active, else keyboard cap
    const useGp = this.input.isGamepadConnected() || activeControlSource === 'gamepad';
    const hintMode = useGp ? 'gp' : 'kb';
    if (hintMode !== this.lastHintMode) {
      this.lastHintMode = hintMode;
      const kb: Record<string, string> = { camera: 'C', weather: 'V', gear: 'G', time: 'T', zoom: 'Z', hud: 'H', reset: '⌫', pause: 'P', airbrake: 'Spc' };
      this.root.querySelectorAll<HTMLElement>('.control-hint').forEach((el) => {
        const a = el.dataset.hintAction || '';
        el.textContent = useGp ? (this.input.getActionGamepadLabel(a) || kb[a] || '') : (kb[a] || '');
      });
    }
    const veilOpacity = Math.min(0.76, telemetry.cloudDensity * 0.8);
    this.cloudVeilEl.style.opacity = veilOpacity.toFixed(3);

    if (gpStatus.bannerTitle && !this.inMenu) {
      this.bannerEl.classList.remove('hidden');
      this.bannerTitleEl.textContent = gpStatus.bannerTitle;
      this.bannerSubEl.textContent = gpStatus.bannerSubtitle ? `— ${gpStatus.bannerSubtitle}` : '';
    } else {
      this.bannerEl.classList.add('hidden');
    }

    if (this.inMenu && this.activeTab === 'controller') {
      const snap = this.input.getLiveGamepadSnapshot();
      const statusEl = document.getElementById('gp-live-status');
      const leftDot = document.getElementById('gp-dot-left');
      const rightDot = document.getElementById('gp-dot-right');
      const btnGrid = document.getElementById('gp-buttons-grid');

      if (statusEl) {
        statusEl.textContent = snap.connected
          ? `Connected: ${snap.profileLabel}`
          : 'No Gamepad Active — Press any controller button';
        statusEl.style.color = snap.connected ? '#6ee7b7' : '#fda4af';
      }
      if (leftDot && snap.connected) {
        const lx = (snap.axes[this.input.settings.mapping.rollAxis] ?? 0) * 24;
        const ly = (snap.axes[this.input.settings.mapping.pitchAxis] ?? 0) * 24;
        leftDot.style.transform = `translate(calc(-50% + ${lx}px), calc(-50% + ${ly}px))`;
      }
      if (rightDot && snap.connected) {
        const rx = (snap.axes[this.input.settings.mapping.yawAxis] ?? 0) * 24;
        const ry = (snap.axes[3] ?? 0) * 24;
        rightDot.style.transform = `translate(calc(-50% + ${rx}px), calc(-50% + ${ry}px))`;
      }
      if (btnGrid) {
        btnGrid.innerHTML = snap.connected
          ? snap.buttons
              .map(
                (b, i) =>
                  `<span class="gp-btn-chip ${b.pressed ? 'pressed' : ''}">B${i}${b.value > 0.05 ? ` (${Math.round(b.value * 100)}%)` : ''}</span>`
              )
              .join('')
          : '';
      }
    }

    if (this.inMenu) return;

    // Update live compact FPS badge
    const fps = Math.round(this.hooks.getCurrentFps());
    const fpsValEl = document.getElementById('hud-fps-val');
    const fpsDotEl = document.getElementById('hud-fps-dot');
    if (fpsValEl) fpsValEl.textContent = `${fps} FPS`;
    if (fpsDotEl) {
      fpsDotEl.className = `fps-dot ${fps >= 48 ? 'good' : fps >= 30 ? 'mid' : 'low'}`;
    }
    this.fpsChipEl.style.opacity = this.hudMode === 'minimal' ? '1' : '0.55';

    // Update single-line minimal top HUD strip (zero emoji!)
    const spdKts = Math.round(telemetry.airspeedKts);
    const altFt = Math.round(telemetry.altitudeFt);
    const hdg = Math.round(telemetry.headingDeg) || 360;
    const thrPct = Math.round(telemetry.throttle * 100);
    const gpConnected = this.input.isGamepadConnected();
    const clk = formatHourClock(this.hooks.getCurrentHour());

    let extraTag = '';
    if (telemetry.stalling) {
      extraTag = ' <span class="hud-sep">·</span> <span class="hud-warn-tag">STALL</span>';
    } else if (telemetry.waterSkimIntensity > 0.2) {
      extraTag = ' <span class="hud-sep">·</span> <span class="hud-sky-tag">SEA SKIM</span>';
    } else if (gpStatus.mode === 'missions') {
      extraTag = ` <span class="hud-sep">·</span> MISSION ${gpStatus.missionIndex ?? 1}/${gpStatus.missionTotal ?? 6}${gpStatus.missionCompleted ? ' ✓' : ''}`;
    } else if (gpStatus.mode === 'scenic_journey') {
      const dStr =
        gpStatus.waypointDistanceM >= 1000
          ? `${(gpStatus.waypointDistanceM / 1000).toFixed(1)}km`
          : `${gpStatus.waypointDistanceM}m`;
      extraTag = ` <span class="hud-sep">·</span> WP ${gpStatus.waypointIndex}/${gpStatus.waypointTotal} (${dStr})`;
    } else if (telemetry.onGround) {
      extraTag =
        telemetry.surfaceType === 'highway'
          ? ' <span class="hud-sep">·</span> HIGHWAY'
          : ' <span class="hud-sep">·</span> RUNWAY';
    }

    const txtEl = document.getElementById('hud-txt-line');
    if (txtEl) {
      const gpPrefix = gpConnected ? `${iconSvg('gamepad', 12)} ` : '';
      txtEl.innerHTML = `${gpPrefix}${spdKts} KT <span class="hud-sep">·</span> ${altFt.toLocaleString()} FT <span class="hud-sep">·</span> ${String(hdg).padStart(3, '0')}° ${this.cardinalFromHeading(hdg)} <span class="hud-sep">·</span> THR ${thrPct}% <span class="hud-sep hud-hide-narrow">·</span> <span class="hud-hide-narrow">${clk}</span>${extraTag}`;
    }

    const hudGearTxt = document.getElementById('hud-gear-txt');
    if (hudGearTxt) hudGearTxt.textContent = telemetry.gearDown ? 'DN' : 'UP';

    const pitchPx = Math.max(-28, Math.min(28, telemetry.pitchDeg * 1.1));
    this.horizonLineEl.style.transform = `translateY(${pitchPx}px) rotate(${-telemetry.rollDeg}deg)`;

    const showTouch =
      this.input.isTouchDevice() &&
      !(gpConnected && activeControlSource === 'gamepad') &&
      this.hudMode !== 'immersive';
    this.touchWrapEl.classList.toggle('hidden', !showTouch);

    if (showTouch) {
      this.thrFillEl.style.height = `${thrPct}%`;
      this.thrPctLabelEl.textContent = `${thrPct}%`;
    }
  }
}
