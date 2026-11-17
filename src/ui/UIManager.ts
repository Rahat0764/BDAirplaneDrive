import { AIRCRAFT_ORDER, AIRCRAFT_SPECS } from '../aircraft/AircraftModel';
import { AudioSystem } from '../audio/AudioSystem';
import { CAMERA_LABELS, CameraSystem } from '../camera/CameraSystem';
import { InputManager } from '../controls/InputManager';
import { FlightPhysics } from '../flight/FlightPhysics';
import { GAMEPLAY_MODE_INFO, GameplayManager, GameplayStatus } from '../gameplay/GameplayManager';
import {
  AircraftVariantId,
  AtmospherePresetId,
  FlightTelemetry,
  GameplayModeId,
  GraphicsPresetId,
  HudModeId,
} from '../types';
import { ATMOSPHERE_ORDER, ATMOSPHERE_PRESETS, GRAPHICS_PRESETS } from '../world/AtmospherePresets';

type MenuTab = 'modes' | 'aircraft' | 'environment' | 'graphics' | 'controller' | 'audio';

export interface UIHooks {
  onStartFlight: (mode: GameplayModeId, specialSpawn?: 'none' | 'runway' | 'highway') => void;
  onResumeFlight: () => void;
  onSelectAircraft: (variant: AircraftVariantId) => void;
  onSelectAtmosphere: (preset: AtmospherePresetId) => void;
  onSelectGraphics: (preset: GraphicsPresetId) => void;
  getActiveAircraft: () => AircraftVariantId;
  getActiveAtmosphere: () => AtmospherePresetId;
  getActiveGraphics: () => GraphicsPresetId;
  getCurrentFps: () => number;
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

  private hudLayerEl!: HTMLElement;
  private metricsInlineEl!: HTMLElement;
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

  constructor(
    private input: InputManager,
    private physics: FlightPhysics,
    private cameraSys: CameraSystem,
    private audio: AudioSystem,
    private gameplay: GameplayManager,
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
    this.menuOverlayEl.classList.remove('hidden');
    this.menuFsFabEl.classList.remove('hidden');
    this.hudLayerEl.classList.add('hidden');
    this.primaryResumeBtn.textContent = pausedFromFlight || this.hasStartedOnce ? 'Resume Flight' : 'Start Flight';
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

  public showToast(message: string): void {
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.textContent = message;
    this.toastStackEl.appendChild(el);
    window.setTimeout(() => el.remove(), 3000);
  }

  public cycleHudMode(): void {
    this.hudMode = this.hudMode === 'minimal' ? 'immersive' : 'minimal';
    this.applyHudModeLayout();
    this.showToast(
      this.hudMode === 'minimal'
        ? '1-Line Minimal HUD'
        : 'Immersive Pure View (Tap 👁 to show telemetry)'
    );
  }

  private applyHudModeLayout(): void {
    if (this.hudMode === 'minimal') {
      this.metricsInlineEl.style.visibility = 'visible';
      this.horizonReticleEl.style.display = 'block';
      this.actionsInlineEl.style.opacity = '1';
    } else {
      this.metricsInlineEl.style.visibility = 'hidden';
      this.horizonReticleEl.style.display = 'none';
      this.actionsInlineEl.style.opacity = '0.45';
    }
  }

  /**
   * Requests true edge-to-edge URL-bar-hidden Fullscreen AND locks Android Chrome to Landscape!
   */
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
        // navigationUI: 'hide' hides BOTH Android Chrome URL bar and system navigation bars!
        await docEl.requestFullscreen({ navigationUI: 'hide' });
      } else if (docEl.webkitRequestFullscreen) {
        await docEl.webkitRequestFullscreen();
      }
    } catch {
      // Ignore if browser blocks
    }

    // Lock to landscape AFTER fullscreen activates (required order for Android Chrome!)
    try {
      const scr = screen as unknown as {
        orientation?: { lock?: (mode: string) => Promise<void> };
      };
      if (scr.orientation?.lock) {
        await scr.orientation.lock('landscape').catch(() => scr.orientation?.lock?.('landscape-primary'));
      }
    } catch {
      // Ignore on desktop browsers that don't support orientation lock
    }
  }

  private bindFullscreenSync(): void {
    const syncLabels = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element };
      const isFs = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
      this.menuFsFabEl.textContent = isFs ? '✕ Exit Full Screen' : '⛶ Full Screen + Landscape';
      this.menuInlineFsBtn.textContent = isFs ? '✕ Exit Full' : '⛶ Full Screen';
      this.hudFsBtn.textContent = isFs ? '✕' : '⛶ Full';
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

      <!-- Always-Accessible Floating Fullscreen + Landscape Button on Menu -->
      <button class="menu-fs-fab" id="btn-menu-fs-fab">⛶ Full Screen + Landscape</button>

      <!-- Main Menu / Pause Overlay -->
      <div class="menu-overlay" id="menu-overlay">
        <div class="menu-sidebar">
          <div>
            <div class="brand-eyebrow">Ghibli-Sunlit 3D Aviation</div>
            <h1 class="brand-title">DREAM FLIGHT</h1>
            <p class="brand-subtitle">
              Fly between giant white cumulus cathedrals, sparkling rivers, landable valley highways &amp; moonlit skies.
            </p>
          </div>

          <div class="cta-row">
            <button class="primary-btn" id="btn-start-resume">Start Flight</button>
            <button class="fs-cta-btn" id="btn-menu-fs-inline" title="Hide URL bar &amp; rotate to Landscape">⛶ Full Screen</button>
          </div>

          <div class="menu-nav-grid" id="menu-tabs">
            <button class="nav-tab-btn active" data-tab="modes">Flight &amp; Roads</button>
            <button class="nav-tab-btn" data-tab="environment">Sky &amp; Light</button>
            <button class="nav-tab-btn" data-tab="aircraft">Aircraft</button>
            <button class="nav-tab-btn" data-tab="controller">Controller &amp; Rumble</button>
            <button class="nav-tab-btn" data-tab="graphics">Graphics</button>
            <button class="nav-tab-btn" data-tab="audio">Audio</button>
          </div>
        </div>

        <div class="menu-detail-panel" id="menu-detail"></div>
      </div>

      <!-- STRICTLY SINGLE-LINE ULTRA-MINIMAL IN-FLIGHT HUD -->
      <div class="hud-layer hidden" id="hud-layer">
        <div class="hud-single-line">
          <div class="hud-metrics-inline" id="hud-metrics-inline">
            <span id="hud-txt-line">112 KT · 1,770 FT · 360° N · THR 68%</span>
          </div>

          <div class="hud-actions-inline" id="hud-actions-inline">
            <button class="hud-icon-btn" id="btn-hud-cam" title="Switch Camera">🎥</button>
            <button class="hud-icon-btn" id="btn-hud-gear" title="Toggle Landing Gear">🛞 DN</button>
            <button class="hud-icon-btn hud-hide-narrow" id="btn-hud-sky" title="Change Sky Time">🌤</button>
            <button class="hud-icon-btn" id="btn-hud-mode" title="Toggle Immersive HUD">👁</button>
            <button class="hud-icon-btn hud-hide-narrow" id="btn-hud-reset" title="Reset Plane">↺</button>
            <button class="hud-icon-btn highlight-fs" id="btn-hud-fs" title="Full Screen &amp; Landscape">⛶ Full</button>
            <button class="hud-icon-btn" id="btn-hud-pause" title="Menu">☰</button>
          </div>
        </div>

        <div class="horizon-reticle" id="horizon-reticle">
          <div class="horizon-line" id="horizon-line"></div>
          <div class="horizon-aircraft-wing"></div>
        </div>

        <!-- Mobile / Android Touch Flight Interface -->
        <div class="touch-controls-wrap" id="touch-wrap">
          <div class="touch-joystick-zone" id="joy-zone">
            <div class="touch-joystick-knob" id="joy-knob"></div>
          </div>

          <div class="touch-right-cluster">
            <button class="touch-airbrake-btn" id="btn-touch-brake">BRAKE</button>
            <div class="touch-throttle-track" id="thr-track">
              <div class="touch-throttle-fill" id="thr-fill"></div>
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

    this.hudLayerEl = document.getElementById('hud-layer')!;
    this.metricsInlineEl = document.getElementById('hud-metrics-inline')!;
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

    // Dedicated Fullscreen + Landscape buttons!
    const handleFsClick = () => {
      this.audio.unlockAndStart();
      this.audio.playUiChime(true);
      this.enterOrToggleFullscreenLandscape(false);
    };
    this.menuFsFabEl.addEventListener('click', handleFsClick);
    this.menuInlineFsBtn.addEventListener('click', handleFsClick);
    this.hudFsBtn.addEventListener('click', handleFsClick);

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
      this.showToast(`Camera: ${CAMERA_LABELS[next]}`);
    });

    document.getElementById('btn-hud-gear')!.addEventListener('click', () => {
      this.audio.playUiChime();
      this.input.triggerUiAction('toggleGear');
    });

    document.getElementById('btn-hud-sky')!.addEventListener('click', () => {
      this.audio.playUiChime();
      const cur = this.hooks.getActiveAtmosphere();
      const next = ATMOSPHERE_ORDER[(ATMOSPHERE_ORDER.indexOf(cur) + 1) % ATMOSPHERE_ORDER.length];
      this.hooks.onSelectAtmosphere(next);
      this.showToast(`Sky: ${ATMOSPHERE_PRESETS[next].name}`);
    });

    document.getElementById('btn-hud-mode')!.addEventListener('click', () => {
      this.audio.playUiChime();
      this.cycleHudMode();
    });

    document.getElementById('btn-hud-reset')!.addEventListener('click', () => {
      this.audio.playUiChime();
      this.input.triggerUiAction('resetAircraft');
      this.showToast('Aircraft stabilized in sky');
    });
  }

  private bindTouchControls(): void {
    let joyPointerId: number | null = null;
    const maxRadius = 44;

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
      this.joyKnobEl.style.transform = 'translate(-50%, -50%)';
      this.input.touchStickX = 0;
      this.input.touchStickY = 0;
    };
    this.joyZoneEl.addEventListener('pointerup', resetStick);
    this.joyZoneEl.addEventListener('pointercancel', resetStick);

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
        <div class="panel-title">Flight Modes, Airport &amp; Landable Valley Highway</div>
        <div class="panel-desc">Explore freely, land on Dream Valley Runway 36, or touch down anywhere along the 7.4 km yellow-lined Scenic Valley Highway &amp; River Bridge!</div>
        <div class="card-list">${modeCards}</div>

        <div style="margin-top:11px; display:flex; flex-wrap:wrap; gap:8px;">
          <button class="pill-btn" id="btn-runway-takeoff">🛫 Takeoff from Airport Runway 36</button>
          <button class="pill-btn" id="btn-highway-approach">🛣 Land on Scenic Valley Highway</button>
        </div>

        <div style="margin-top:14px;" class="panel-title">Flight Physics</div>
        <div class="setting-row">
          <span>Flight Mode</span>
          <div>
            <button class="pill-btn ${assist.flightMode === 'relaxed' ? 'active' : ''}" data-fmode="relaxed">Relaxed</button>
            <button class="pill-btn ${assist.flightMode === 'simulation' ? 'active' : ''}" data-fmode="simulation">Simulation</button>
          </div>
        </div>
        <div class="setting-row">
          <span>Gentle Altitude Hold Assist</span>
          <button class="pill-btn ${assist.altitudeAssist ? 'active' : ''}" id="toggle-alt-assist">${assist.altitudeAssist ? 'ON' : 'OFF'}</button>
        </div>
        <div class="setting-row">
          <span>Stall Simulation</span>
          <button class="pill-btn ${assist.stallSimulation ? 'active' : ''}" id="toggle-stall">${assist.stallSimulation ? 'ON' : 'OFF'}</button>
        </div>
        <div class="setting-row">
          <span>Collision Crash Reset (OFF = Forgiving Skim)</span>
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
          this.physics.setAssistOptions({ flightMode: fm });
          this.renderMenuDetail();
        });
      });

      document.getElementById('toggle-alt-assist')?.addEventListener('click', () => {
        this.physics.setAssistOptions({ altitudeAssist: !assist.altitudeAssist });
        this.renderMenuDetail();
      });
      document.getElementById('toggle-stall')?.addEventListener('click', () => {
        this.physics.setAssistOptions({ stallSimulation: !assist.stallSimulation });
        this.renderMenuDetail();
      });
      document.getElementById('toggle-crash')?.addEventListener('click', () => {
        this.physics.setAssistOptions({ collisionDamage: !assist.collisionDamage });
        this.renderMenuDetail();
      });
      return;
    }

    if (this.activeTab === 'environment') {
      const curAtm = this.hooks.getActiveAtmosphere();
      const cards = ATMOSPHERE_ORDER.map((id) => {
        const p = ATMOSPHERE_PRESETS[id];
        return `
          <div class="choice-card ${curAtm === id ? 'selected' : ''}" data-atm="${id}">
            <h4>${p.name}</h4>
            <p>${p.subtitle}</p>
          </div>
        `;
      }).join('');

      this.menuDetailEl.innerHTML = `
        <div class="panel-title">Ghibli Sunlight &amp; Sky Presets</div>
        <div class="panel-desc">Switch live between crisp sunlit skies, golden dusk, and moonlit blue hour.</div>
        <div class="card-list">${cards}</div>
      `;

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
            <p><strong>${s.subtitle}</strong> — Cruise ${s.cruiseSpeedKts} kts • Span ${s.wingSpan}m. ${s.description}</p>
          </div>
        `;
      }).join('');

      this.menuDetailEl.innerHTML = `
        <div class="panel-title">Light Aircraft Hangar</div>
        <div class="panel-desc">Detailed 3D aircraft with real-time shadows, moving control surfaces &amp; retractable landing gear.</div>
        <div class="card-list">${cards}</div>
      `;

      this.menuDetailEl.querySelectorAll('[data-ac]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = (el as HTMLElement).dataset.ac as AircraftVariantId;
          this.audio.playUiChime(true);
          this.hooks.onSelectAircraft(id);
          this.renderMenuDetail();
          this.showToast(`Selected ${AIRCRAFT_SPECS[id].name}`);
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
              <p>Clouds: ${g.cloudClusterCount} towers • Max DPR: ${g.maxDpr}x • Shadows: ${g.shadowMapSize}px</p>
            </div>
          `;
        })
        .join('');

      this.menuDetailEl.innerHTML = `
        <div class="panel-title">Graphics &amp; Performance</div>
        <div class="panel-desc">Live Frame Rate: <strong>${Math.round(this.hooks.getCurrentFps())} FPS</strong>.</div>
        <div class="card-list">${cards}</div>
      `;

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
        <div class="panel-title">PS4 / Bluetooth Controller &amp; Vibration</div>
        <div class="panel-desc">
          Dual-motor controller &amp; Android haptic vibration activates on runway/highway touchdown, ground roll, water skim &amp; terrain contact.
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
              <button class="pill-btn" id="btn-gp-vib-test">📳 Test Vibration</button>
              <button class="pill-btn" id="btn-gp-calibrate">Calibrate Sticks</button>
              <button class="pill-btn" id="btn-gp-reset">Reset Defaults</button>
            </div>
          </div>
          <div class="gp-buttons-grid" id="gp-buttons-grid"></div>
        </div>

        <div class="setting-row">
          <span>Touchdown &amp; Contact Vibration</span>
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
        <div class="setting-row"><span>Pitch Axis</span><button class="pill-btn" data-remap-axis="pitchAxis">Axis ${m.pitchAxis}</button></div>
        <div class="setting-row"><span>Roll Axis</span><button class="pill-btn" data-remap-axis="rollAxis">Axis ${m.rollAxis}</button></div>
        <div class="setting-row"><span>Yaw Axis</span><button class="pill-btn" data-remap-axis="yawAxis">Axis ${m.yawAxis}</button></div>
        <div class="setting-row"><span>Throttle Up (R2/RT)</span><button class="pill-btn" data-remap-btn="throttleUpBtn">Btn ${m.throttleUpBtn}</button></div>
        <div class="setting-row"><span>Throttle Down (L2/LT)</span><button class="pill-btn" data-remap-btn="throttleDownBtn">Btn ${m.throttleDownBtn}</button></div>
        <div class="setting-row"><span>Camera (△/Y)</span><button class="pill-btn" data-remap-btn="cameraBtn">Btn ${m.cameraBtn}</button></div>
        <div class="setting-row"><span>Landing Gear (✕/A)</span><button class="pill-btn" data-remap-btn="gearBtn">Btn ${m.gearBtn}</button></div>
        <div class="setting-row"><span>Air Brakes (□/X)</span><button class="pill-btn" data-remap-btn="airbrakeBtn">Btn ${m.airbrakeBtn}</button></div>
        <div class="setting-row"><span>Reset Plane (○/B)</span><button class="pill-btn" data-remap-btn="resetBtn">Btn ${m.resetBtn}</button></div>
      `;

      document.getElementById('btn-gp-vib-test')?.addEventListener('click', () => {
        this.input.triggerVibration(260, 0.85, 0.65, true);
        this.showToast('Sent vibration pulse to controller / phone');
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
        this.showToast(ok ? 'Analog sticks calibrated!' : 'Connect a gamepad first');
      });
      document.getElementById('btn-gp-reset')?.addEventListener('click', () => {
        this.input.resetControllerDefaults();
        this.showToast('Controller defaults restored');
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

      this.menuDetailEl.querySelectorAll('[data-remap-axis]').forEach((el) => {
        el.addEventListener('click', () => {
          const key = (el as HTMLElement).dataset.remapAxis as keyof typeof m;
          this.remapWaitingLabel = key;
          this.renderMenuDetail();
          this.input.listenForNextGamepadInput('axis', (_k, idx) => {
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
        <div class="panel-desc">Gentle aircraft engine hum, high-altitude wind, touchdown audio &amp; original generative music.</div>

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

  public update(telemetry: FlightTelemetry, gpStatus: GameplayStatus, activeControlSource: string): void {
    const veilOpacity = Math.min(0.84, telemetry.cloudDensity * 0.88);
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

    // Update strictly 1-line minimal top HUD strip!
    const spdKts = Math.round(telemetry.airspeedKts);
    const altFt = Math.round(telemetry.altitudeFt);
    const hdg = Math.round(telemetry.headingDeg) || 360;
    const thrPct = Math.round(telemetry.throttle * 100);
    const gpConnected = this.input.isGamepadConnected();

    let extraTag = '';
    if (telemetry.stalling) {
      extraTag = ' · <span class="hud-warn-tag">STALL</span>';
    } else if (gpStatus.mode === 'scenic_journey') {
      const dStr =
        gpStatus.waypointDistanceM >= 1000
          ? `${(gpStatus.waypointDistanceM / 1000).toFixed(1)}km`
          : `${gpStatus.waypointDistanceM}m`;
      extraTag = ` · WP ${gpStatus.waypointIndex}/${gpStatus.waypointTotal} (${dStr})`;
    } else if (telemetry.onGround) {
      extraTag = telemetry.surfaceType === 'highway' ? ' · HIGHWAY' : ' · RUNWAY';
    }

    const txtEl = document.getElementById('hud-txt-line');
    if (txtEl) {
      txtEl.innerHTML = `${gpConnected ? '🎮 ' : ''}${spdKts} KT <span class="hud-sep">·</span> ${altFt.toLocaleString()} FT <span class="hud-sep">·</span> ${String(hdg).padStart(3, '0')}° ${this.cardinalFromHeading(hdg)} <span class="hud-sep">·</span> THR ${thrPct}%${extraTag}`;
    }

    const hudGearBtn = document.getElementById('btn-hud-gear');
    if (hudGearBtn) hudGearBtn.textContent = `🛞 ${telemetry.gearDown ? 'DN' : 'UP'}`;

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
