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
  onStartFlight: (mode: GameplayModeId, startOnRunway?: boolean) => void;
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

  private menuOverlayEl!: HTMLElement;
  private menuDetailEl!: HTMLElement;
  private primaryResumeBtn!: HTMLButtonElement;

  private hudLayerEl!: HTMLElement;
  private telemClusterEl!: HTMLElement;
  private horizonReticleEl!: HTMLElement;
  private horizonLineEl!: HTMLElement;
  private quickActionsEl!: HTMLElement;

  // Telemetry DOM refs
  private spdValEl!: HTMLElement;
  private altValEl!: HTMLElement;
  private hdgValEl!: HTMLElement;
  private vsiValEl!: HTMLElement;
  private thrValEl!: HTMLElement;
  private modeBadgeEl!: HTMLElement;
  private gearBadgeEl!: HTMLElement;
  private ctrlBadgeEl!: HTMLElement;
  private wpBadgeEl!: HTMLElement;

  // Touch DOM refs
  private touchWrapEl!: HTMLElement;
  private joyZoneEl!: HTMLElement;
  private joyKnobEl!: HTMLElement;
  private thrFillEl!: HTMLElement;
  private thrPctLabelEl!: HTMLElement;
  private airbrakeTouchBtn!: HTMLButtonElement;

  private activeTab: MenuTab = 'modes';
  private hudMode: HudModeId = 'full';
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
    this.renderMenuDetail();
  }

  public isMenuOpen(): boolean {
    return this.inMenu;
  }

  public openMenu(pausedFromFlight = false): void {
    this.inMenu = true;
    this.menuOverlayEl.classList.remove('hidden');
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
    this.hudLayerEl.classList.remove('hidden');
    this.applyHudModeLayout();
  }

  public showToast(message: string): void {
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.textContent = message;
    this.toastStackEl.appendChild(el);
    window.setTimeout(() => {
      el.remove();
    }, 3400);
  }

  public cycleHudMode(): void {
    const order: HudModeId[] = ['full', 'minimal', 'immersive'];
    this.hudMode = order[(order.indexOf(this.hudMode) + 1) % order.length];
    this.applyHudModeLayout();
    const names: Record<HudModeId, string> = {
      full: 'HUD: Full Aviation',
      minimal: 'HUD: Minimal',
      immersive: 'Immersive Cinema Mode (Tap HUD button to restore)',
    };
    this.showToast(names[this.hudMode]);
  }

  private applyHudModeLayout(): void {
    if (this.hudMode === 'full') {
      this.telemClusterEl.style.display = 'flex';
      this.horizonReticleEl.style.display = 'block';
      this.quickActionsEl.style.opacity = '1';
    } else if (this.hudMode === 'minimal') {
      this.telemClusterEl.style.display = 'flex';
      this.horizonReticleEl.style.display = 'none';
      this.quickActionsEl.style.opacity = '0.9';
    } else {
      // Immersive Mode: hides instruments & horizon so giant clouds & scenery fill the screen purely!
      this.telemClusterEl.style.display = 'none';
      this.horizonReticleEl.style.display = 'none';
      this.quickActionsEl.style.opacity = '0.38';
    }
  }

  private buildDom(): void {
    this.root.innerHTML = `
      <div class="toast-stack" id="toast-stack"></div>

      <div class="vista-banner hidden" id="vista-banner">
        <h3 id="vista-title"></h3>
        <p id="vista-sub"></p>
      </div>

      <!-- Main Menu / Pause Overlay -->
      <div class="menu-overlay" id="menu-overlay">
        <div class="menu-sidebar">
          <div>
            <div class="brand-eyebrow">Peaceful 3D Aviation</div>
            <h1 class="brand-title">DREAM FLIGHT</h1>
            <p class="brand-subtitle">
              Soar between towering white cumulus cathedrals, emerald valleys, oceans &amp; moonlit skies.
            </p>
          </div>

          <button class="primary-btn" id="btn-start-resume">Start Flight</button>

          <div class="menu-nav-grid" id="menu-tabs">
            <button class="nav-tab-btn active" data-tab="modes">Flight &amp; Routes</button>
            <button class="nav-tab-btn" data-tab="environment">Sky &amp; Time</button>
            <button class="nav-tab-btn" data-tab="aircraft">Aircraft</button>
            <button class="nav-tab-btn" data-tab="controller">Controllers</button>
            <button class="nav-tab-btn" data-tab="graphics">Graphics</button>
            <button class="nav-tab-btn" data-tab="audio">Audio</button>
          </div>

          <div style="font-size:11.5px; color:var(--text-secondary); line-height:1.45; border-top:1px solid rgba(255,255,255,0.1); padding-top:10px;">
            <strong>Quick Controls:</strong> Touch Stick &amp; Throttle • PS4 / Bluetooth Gamepad • Desktop <code>WASD</code> / Arrows + <code>Shift/Ctrl</code> Throttle + <code>C</code> Camera
          </div>
        </div>

        <div class="menu-detail-panel" id="menu-detail"></div>
      </div>

      <!-- In-Flight HUD & Touch Controls -->
      <div class="hud-layer hidden" id="hud-layer">
        <div class="hud-top-bar">
          <div class="hud-QuickActions" id="hud-quick-actions">
            <button class="hud-btn" id="btn-hud-pause">☰ Menu</button>
            <button class="hud-btn" id="btn-hud-cam">🎥 Chase View</button>
            <button class="hud-btn" id="btn-hud-gear">🛞 Gear: DN</button>
            <button class="hud-btn" id="btn-hud-sky">🌤 Sky</button>
            <button class="hud-btn" id="btn-hud-mode">👁 HUD</button>
            <button class="hud-btn" id="btn-hud-reset">↺ Reset</button>
            <button class="hud-btn" id="btn-hud-fs">⛶ Full</button>
          </div>
        </div>

        <div class="hud-telemetry-cluster" id="telem-cluster">
          <div class="telem-grid">
            <div class="telem-item"><span>Airspeed</span><strong id="val-spd">112 kts</strong></div>
            <div class="telem-item"><span>Altitude</span><strong id="val-alt">1,770 ft</strong></div>
            <div class="telem-item"><span>Heading</span><strong id="val-hdg">360° N</strong></div>
            <div class="telem-item"><span>Vert Spd</span><strong id="val-vsi">+0 fpm</strong></div>
          </div>
          <div class="hud-badges">
            <span class="mini-badge good" id="badge-thr">THR 68%</span>
            <span class="mini-badge" id="badge-fmode">Relaxed</span>
            <span class="mini-badge" id="badge-gear">GEAR DN</span>
            <span class="mini-badge" id="badge-ctrl">Touch/Keys</span>
            <span class="mini-badge good" id="badge-wp" style="display:none;"></span>
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
            <div class="touch-zone-label">Pitch &amp; Roll</div>
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

    this.menuOverlayEl = document.getElementById('menu-overlay')!;
    this.menuDetailEl = document.getElementById('menu-detail')!;
    this.primaryResumeBtn = document.getElementById('btn-start-resume') as HTMLButtonElement;

    this.hudLayerEl = document.getElementById('hud-layer')!;
    this.telemClusterEl = document.getElementById('telem-cluster')!;
    this.horizonReticleEl = document.getElementById('horizon-reticle')!;
    this.horizonLineEl = document.getElementById('horizon-line')!;
    this.quickActionsEl = document.getElementById('hud-quick-actions')!;

    this.spdValEl = document.getElementById('val-spd')!;
    this.altValEl = document.getElementById('val-alt')!;
    this.hdgValEl = document.getElementById('val-hdg')!;
    this.vsiValEl = document.getElementById('val-vsi')!;
    this.thrValEl = document.getElementById('badge-thr')!;
    this.modeBadgeEl = document.getElementById('badge-fmode')!;
    this.gearBadgeEl = document.getElementById('badge-gear')!;
    this.ctrlBadgeEl = document.getElementById('badge-ctrl')!;
    this.wpBadgeEl = document.getElementById('badge-wp')!;

    this.touchWrapEl = document.getElementById('touch-wrap')!;
    this.joyZoneEl = document.getElementById('joy-zone')!;
    this.joyKnobEl = document.getElementById('joy-knob')!;
    this.thrFillEl = document.getElementById('thr-fill')!;
    this.thrPctLabelEl = document.getElementById('thr-pct-lbl')!;
    this.airbrakeTouchBtn = document.getElementById('btn-touch-brake') as HTMLButtonElement;

    // Bind Menu Events
    this.primaryResumeBtn.addEventListener('click', () => {
      this.audio.unlockAndStart();
      this.audio.playUiChime(true);
      if (this.hasStartedOnce) {
        this.closeMenu();
        this.hooks.onResumeFlight();
      } else {
        this.closeMenu();
        this.hooks.onStartFlight(this.gameplay.getMode(), false);
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

    // Bind HUD Quick Buttons
    document.getElementById('btn-hud-pause')!.addEventListener('click', () => {
      this.audio.playUiChime();
      this.openMenu(true);
    });

    const camBtn = document.getElementById('btn-hud-cam')!;
    camBtn.addEventListener('click', () => {
      this.audio.playUiChime();
      const next = this.cameraSys.cycleMode();
      camBtn.textContent = `🎥 ${CAMERA_LABELS[next]}`;
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
      this.showToast(`Atmosphere: ${ATMOSPHERE_PRESETS[next].name}`);
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

    document.getElementById('btn-hud-fs')!.addEventListener('click', () => {
      this.audio.playUiChime();
      this.toggleFullscreen();
    });
  }

  private toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      const scr = screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } };
      scr.orientation?.lock?.('landscape').catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  private bindTouchControls(): void {
    // Multi-touch Virtual Flight Joystick (supports simultaneous throttle dragging!)
    let joyPointerId: number | null = null;
    const maxRadius = 46;

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
      this.input.touchStickY = dy / maxRadius; // Drag down (+dy) = pull stick back = pitch nose up!
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

    // Touch Throttle Slider
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

    // Touch Airbrake Hold Button
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
        <div class="panel-title">Flight Modes &amp; Aerodynamics</div>
        <div class="panel-desc">Choose a peaceful experience—or take off manually from Dream Valley Runway 36 straight into the Cloud Canyon.</div>
        <div class="card-list">${modeCards}</div>

        <div style="margin-top:12px;">
          <button class="pill-btn" id="btn-runway-takeoff">🛫 Spawn on Airport Runway 36 for Takeoff</button>
        </div>

        <div style="margin-top:16px;" class="panel-title">Flight Physics Behavior</div>
        <div class="setting-row">
          <span>Flight Mode</span>
          <div>
            <button class="pill-btn ${assist.flightMode === 'relaxed' ? 'active' : ''}" data-fmode="relaxed">Relaxed (Peaceful)</button>
            <button class="pill-btn ${assist.flightMode === 'simulation' ? 'active' : ''}" data-fmode="simulation">Normal Simulation</button>
          </div>
        </div>
        <div class="setting-row">
          <span>Gentle Altitude Hold Assist (Relaxed)</span>
          <button class="pill-btn ${assist.altitudeAssist ? 'active' : ''}" id="toggle-alt-assist">${assist.altitudeAssist ? 'ON' : 'OFF'}</button>
        </div>
        <div class="setting-row">
          <span>Aerodynamic Stall Simulation</span>
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
          this.hooks.onStartFlight(m, false);
        });
      });

      document.getElementById('btn-runway-takeoff')?.addEventListener('click', () => {
        this.audio.unlockAndStart();
        this.audio.playUiChime(true);
        this.closeMenu();
        this.hooks.onStartFlight('free_flight', true);
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
        <div class="panel-title">Sky &amp; Atmospheric Lighting Presets</div>
        <div class="panel-desc">Watch the live 3D sky, clouds, moon, and valley transform immediately behind this menu.</div>
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
        <div class="panel-desc">Each aircraft features animated ailerons, elevator, rudder, landing gear, navigation strobes &amp; custom flight dynamics.</div>
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
              <p>Clouds: ${g.cloudClusterCount} towers • Max DPR: ${g.maxDpr}x • Shadows: ${g.shadowsEnabled ? g.shadowMapSize + 'px' : 'Off'}</p>
            </div>
          `;
        })
        .join('');

      this.menuDetailEl.innerHTML = `
        <div class="panel-title">Graphics &amp; Mobile Optimization</div>
        <div class="panel-desc">Current Live Frame Rate: <strong>${Math.round(this.hooks.getCurrentFps())} FPS</strong>. Volumetric cloud atmosphere stays active across all presets.</div>
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
        <div class="panel-title">PS4 DualShock 4 &amp; Bluetooth Controller Settings</div>
        <div class="panel-desc">
          Supports DualShock 4, DualSense, Xbox &amp; Bluetooth gamepads via the Browser Gamepad API.
          <em>Note: Android browsers may map Bluetooth axes differently across OS versions—use the live tester &amp; remapper below if needed.</em>
        </div>

        <div class="gp-tester-box">
          <div style="font-size:12.5px; font-weight:600; color:${snap.connected ? '#6ee7b7' : '#fda4af'};" id="gp-live-status">
            ${snap.connected ? `Connected: ${snap.profileLabel}` : 'No Gamepad Active — Press any controller button'}
          </div>
          <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;" id="gp-live-note">${snap.compatibilityNote}</div>
          <div class="gp-sticks-row">
            <div>
              <div class="stick-viz"><div class="stick-dot" id="gp-dot-left"></div></div>
              <div style="font-size:10px; text-align:center; margin-top:3px; color:var(--text-secondary);">Pitch / Roll</div>
            </div>
            <div>
              <div class="stick-viz"><div class="stick-dot" id="gp-dot-right"></div></div>
              <div style="font-size:10px; text-align:center; margin-top:3px; color:var(--text-secondary);">Yaw / Look</div>
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              <button class="pill-btn" id="btn-gp-calibrate">Calibrate Stick Center</button>
              <button class="pill-btn" id="btn-gp-reset">Reset Default Mapping</button>
            </div>
          </div>
          <div class="gp-buttons-grid" id="gp-buttons-grid"></div>
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

        <div style="margin-top:10px; font-size:12px; color:var(--accent-gold);">
          ${this.remapWaitingLabel ? `Move stick or press button on controller for: <strong>${this.remapWaitingLabel}</strong>...` : 'Custom Button & Axis Mapping (Click to Remap):'}
        </div>
        <div class="setting-row"><span>Pitch Axis</span><button class="pill-btn" data-remap-axis="pitchAxis">Axis ${m.pitchAxis}</button></div>
        <div class="setting-row"><span>Roll Axis</span><button class="pill-btn" data-remap-axis="rollAxis">Axis ${m.rollAxis}</button></div>
        <div class="setting-row"><span>Yaw Axis</span><button class="pill-btn" data-remap-axis="yawAxis">Axis ${m.yawAxis}</button></div>
        <div class="setting-row"><span>Increase Throttle (R2/RT)</span><button class="pill-btn" data-remap-btn="throttleUpBtn">Btn ${m.throttleUpBtn}</button></div>
        <div class="setting-row"><span>Decrease Throttle (L2/LT)</span><button class="pill-btn" data-remap-btn="throttleDownBtn">Btn ${m.throttleDownBtn}</button></div>
        <div class="setting-row"><span>Switch Camera (△/Y)</span><button class="pill-btn" data-remap-btn="cameraBtn">Btn ${m.cameraBtn}</button></div>
        <div class="setting-row"><span>Landing Gear (✕/A)</span><button class="pill-btn" data-remap-btn="gearBtn">Btn ${m.gearBtn}</button></div>
        <div class="setting-row"><span>Air Brakes (□/X)</span><button class="pill-btn" data-remap-btn="airbrakeBtn">Btn ${m.airbrakeBtn}</button></div>
        <div class="setting-row"><span>Reset Aircraft (○/B)</span><button class="pill-btn" data-remap-btn="resetBtn">Btn ${m.resetBtn}</button></div>
      `;

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
        this.showToast(ok ? 'Analog sticks calibrated!' : 'Connect a gamepad first to calibrate');
      });
      document.getElementById('btn-gp-reset')?.addEventListener('click', () => {
        this.input.resetControllerDefaults();
        this.showToast('Controller mapping restored to PS4/Standard defaults');
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
            this.showToast(`Mapped ${key} to Button ${idx}`);
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
            this.showToast(`Mapped ${key} to Axis ${idx}`);
            this.renderMenuDetail();
          });
        });
      });
      return;
    }

    if (this.activeTab === 'audio') {
      const a = this.audio.settings;
      this.menuDetailEl.innerHTML = `
        <div class="panel-title">Peaceful Soundscape &amp; Ambient Music</div>
        <div class="panel-desc">Procedural light-aircraft engine harmonics, silky high-altitude wind, and original generative ambient music.</div>

        <div class="setting-row">
          <span>Master Audio</span>
          <button class="pill-btn ${a.masterEnabled ? 'active' : ''}" id="btn-aud-master">${a.masterEnabled ? 'Enabled' : 'Muted'}</button>
        </div>
        <div class="setting-row">
          <span>Engine &amp; Propeller Volume (${Math.round(a.engineVolume * 100)}%)</span>
          <input type="range" id="rng-eng" min="0" max="1" step="0.02" value="${a.engineVolume}" />
        </div>
        <div class="setting-row">
          <span>Wind &amp; Sky Ambience (${Math.round(a.ambientVolume * 100)}%)</span>
          <input type="range" id="rng-amb" min="0" max="1" step="0.02" value="${a.ambientVolume}" />
        </div>
        <div class="setting-row">
          <span>Dream Ambient Music (${Math.round(a.musicVolume * 100)}%)</span>
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
    // 1. Update Cloud Fly-Through Atmospheric Veil smoothly!
    const veilOpacity = Math.min(0.84, telemetry.cloudDensity * 0.88);
    this.cloudVeilEl.style.opacity = veilOpacity.toFixed(3);

    // 2. Update Scenic Vista Banner
    if (gpStatus.bannerTitle && !this.inMenu) {
      this.bannerEl.classList.remove('hidden');
      this.bannerTitleEl.textContent = gpStatus.bannerTitle;
      this.bannerSubEl.textContent = gpStatus.bannerSubtitle || '';
    } else {
      this.bannerEl.classList.add('hidden');
    }

    // 3. If Controller Settings tab is open, update live visualizer @ 60Hz!
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
        const lx = (snap.axes[this.input.settings.mapping.rollAxis] ?? 0) * 28;
        const ly = (snap.axes[this.input.settings.mapping.pitchAxis] ?? 0) * 28;
        leftDot.style.transform = `translate(calc(-50% + ${lx}px), calc(-50% + ${ly}px))`;
      }
      if (rightDot && snap.connected) {
        const rx = (snap.axes[this.input.settings.mapping.yawAxis] ?? 0) * 28;
        const ry = (snap.axes[3] ?? 0) * 28;
        rightDot.style.transform = `translate(calc(-50% + ${rx}px), calc(-50% + ${ry}px))`;
      }
      if (btnGrid) {
        if (!snap.connected) {
          btnGrid.innerHTML = '';
        } else {
          btnGrid.innerHTML = snap.buttons
            .map(
              (b, i) =>
                `<span class="gp-btn-chip ${b.pressed ? 'pressed' : ''}">B${i}${b.value > 0.05 ? ` (${Math.round(b.value * 100)}%)` : ''}</span>`
            )
            .join('');
        }
      }
    }

    if (this.inMenu) return;

    // 4. Update HUD Telemetry & Artificial Horizon
    const spdKts = Math.round(telemetry.airspeedKts);
    const altFt = Math.round(telemetry.altitudeFt);
    const hdg = Math.round(telemetry.headingDeg) || 360;
    const vsi = Math.round(telemetry.verticalSpeedFpm / 10) * 10;
    const thrPct = Math.round(telemetry.throttle * 100);

    this.spdValEl.textContent = `${spdKts} kts`;
    this.altValEl.textContent = `${altFt.toLocaleString()} ft`;
    this.hdgValEl.textContent = `${String(hdg).padStart(3, '0')}° ${this.cardinalFromHeading(hdg)}`;
    this.vsiValEl.textContent = `${vsi >= 0 ? '+' : ''}${vsi} fpm`;
    this.thrValEl.textContent = `THR ${thrPct}%`;

    const assist = this.physics.getAssistOptions();
    this.modeBadgeEl.textContent = telemetry.stalling
      ? 'STALL'
      : assist.flightMode === 'relaxed'
      ? 'Relaxed'
      : 'Sim';
    this.modeBadgeEl.className = `mini-badge ${telemetry.stalling ? 'warn' : ''}`;

    this.gearBadgeEl.textContent = telemetry.gearDown ? 'GEAR DN' : 'GEAR UP';
    const hudGearBtn = document.getElementById('btn-hud-gear');
    if (hudGearBtn) hudGearBtn.textContent = `🛞 Gear: ${telemetry.gearDown ? 'DN' : 'UP'}`;

    const gpConnected = this.input.isGamepadConnected();
    this.ctrlBadgeEl.textContent = gpConnected
      ? '🎮 Gamepad'
      : activeControlSource === 'touch'
      ? '📱 Touch'
      : '⌨ Keys';
    this.ctrlBadgeEl.className = `mini-badge ${gpConnected ? 'good' : ''}`;

    if (gpStatus.mode === 'scenic_journey' || gpStatus.mode === 'landing_challenge') {
      this.wpBadgeEl.style.display = 'inline-block';
      const distKm =
        gpStatus.waypointDistanceM >= 1000
          ? `${(gpStatus.waypointDistanceM / 1000).toFixed(1)} km`
          : `${gpStatus.waypointDistanceM} m`;
      this.wpBadgeEl.textContent =
        gpStatus.mode === 'scenic_journey'
          ? `WP ${gpStatus.waypointIndex}/${gpStatus.waypointTotal}: ${distKm}`
          : `RWY 36: ${distKm}`;
    } else {
      this.wpBadgeEl.style.display = 'none';
    }

    // Artificial Horizon line pitch & roll
    const pitchPx = Math.max(-42, Math.min(42, telemetry.pitchDeg * 1.4));
    this.horizonLineEl.style.transform = `translateY(${pitchPx}px) rotate(${-telemetry.rollDeg}deg)`;

    // Show touch controls automatically on touch devices unless user is actively flying with a physical gamepad
    const showTouch =
      this.input.isTouchDevice() && !(gpConnected && activeControlSource === 'gamepad') && this.hudMode !== 'immersive';
    this.touchWrapEl.classList.toggle('hidden', !showTouch);

    if (showTouch) {
      this.thrFillEl.style.height = `${thrPct}%`;
      this.thrPctLabelEl.textContent = `${thrPct}%`;
    }
  }
}
