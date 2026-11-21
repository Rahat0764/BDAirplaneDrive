import {
  ControlInputs,
  ControllerMapping,
  ControllerSettings,
  HapticFeedbackEvents,
  MenuNavActions,
} from '../types';
import { clamp } from '../utils/noise';

const STORAGE_KEY = 'dream_flight_controller_v3';

export const DEFAULT_CONTROLLER_MAPPING: ControllerMapping = {
  pitchAxis: 1,
  rollAxis: 0,
  yawAxis: 2,
  throttleUpBtn: 7,   // R2 / RT
  throttleDownBtn: 6, // L2 / LT
  cameraBtn: 4,       // L1 / LB -> Switch Camera
  weatherBtn: 5,      // R1 / RB -> Switch Weather
  timeBtn: 3,         // Triangle / Y -> Switch Time of Day
  gearBtn: 0,         // Cross / A -> Landing Gear
  airbrakeBtn: 2,     // Square / X -> Airbrake (hold)
  resetBtn: 1,        // Circle / B -> Reset / Stabilize
  pauseBtn: 9,        // Options / Start -> Menu
  hudBtn: 8,          // Share / Select -> Toggle HUD Mode
  zoomBtn: 11,        // R3 -> Camera Zoom Distance
};

export interface GamepadSnapshot {
  connected: boolean;
  id: string;
  profileLabel: string;
  standardMapping: boolean;
  vibrationSupported: boolean;
  axes: number[];
  buttons: Array<{ pressed: boolean; value: number }>;
  compatibilityNote: string;
}

type ExtendedGamepad = Omit<Gamepad, 'vibrationActuator'> & {
  vibrationActuator?: {
    type?: string;
    playEffect?: (
      type: string,
      params: {
        startDelay?: number;
        duration: number;
        weakMagnitude?: number;
        strongMagnitude?: number;
      }
    ) => Promise<unknown>;
  } | null;
  hapticActuators?: Array<{
    pulse?: (value: number, duration: number) => Promise<unknown>;
  }>;
};

export class InputManager {
  public settings: ControllerSettings = {
    deadzone: 0.11,
    sensitivity: 1.0,
    invertPitch: false,
    vibrationEnabled: true,
    axisCenterOffsets: [0, 0, 0, 0],
    mapping: { ...DEFAULT_CONTROLLER_MAPPING },
  };

  private keys = new Set<string>();
  private oneShotActions = {
    toggleGear: false,
    switchCamera: false,
    cycleWeather: false,
    cycleTime: false,
    cycleAircraft: false,
    toggleZoom: false,
    resetAircraft: false,
    togglePause: false,
    cycleHud: false,
  };

  public touchStickX = 0;
  public touchStickY = 0;
  public touchYaw = 0;
  public touchThrottleDirect: number | null = null;
  public touchAirbrake = false;
  private touchActive = false;

  private lookAccumX = 0;
  private lookAccumY = 0;
  private pointerDraggingLook = false;
  private lookPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private activeGamepadIndex: number | null = null;
  private prevBtnPressed: boolean[] = [];
  private activeSource: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  private onConnectionChange?: (connected: boolean, label: string) => void;
  private remapCaptureCallback: ((kind: 'button' | 'axis', index: number) => void) | null = null;

  private rollRumbleTimer = 0;
  private impulseLockUntil = 0;
  private stickNavCooldown = 0;

  constructor(canvas: HTMLCanvasElement, onGamepadNotice?: (connected: boolean, label: string) => void) {
    this.onConnectionChange = onGamepadNotice;
    this.loadSettings();
    this.bindKeyboard();
    this.bindPointerLook(canvas);
    this.bindGamepadEvents();
  }

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ControllerSettings>;
        this.settings = {
          ...this.settings,
          ...parsed,
          mapping: { ...DEFAULT_CONTROLLER_MAPPING, ...(parsed.mapping || {}) },
        };
      }
    } catch {
      // Ignore
    }
  }

  public saveSettings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore
    }
  }

  public resetControllerDefaults(): void {
    this.settings = {
      deadzone: 0.11,
      sensitivity: 1.0,
      invertPitch: false,
      vibrationEnabled: true,
      axisCenterOffsets: [0, 0, 0, 0],
      mapping: { ...DEFAULT_CONTROLLER_MAPPING },
    };
    this.saveSettings();
  }

  public triggerVibration(durationMs: number, strongMag: number, weakMag: number, allowPhoneFallback = true): void {
    if (!this.settings.vibrationEnabled) return;

    const gp = this.findActiveGamepad() as ExtendedGamepad | null;
    let handledByGamepad = false;

    if (gp) {
      if (gp.vibrationActuator && typeof gp.vibrationActuator.playEffect === 'function') {
        handledByGamepad = true;
        gp.vibrationActuator
          .playEffect('dual-rumble', {
            startDelay: 0,
            duration: Math.round(durationMs),
            strongMagnitude: clamp(strongMag, 0, 1),
            weakMagnitude: clamp(weakMag, 0, 1),
          })
          .catch(() => {});
      } else if (gp.hapticActuators && gp.hapticActuators.length > 0 && typeof gp.hapticActuators[0]?.pulse === 'function') {
        handledByGamepad = true;
        gp.hapticActuators[0].pulse(clamp(Math.max(strongMag, weakMag), 0, 1), durationMs).catch(() => {});
      }
    }

    if (!handledByGamepad && allowPhoneFallback && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(Math.min(220, Math.max(16, Math.round(durationMs * Math.max(strongMag, 0.35)))));
      } catch {
        // Ignore
      }
    }
  }

  public processFlightHaptics(dt: number, haptics: HapticFeedbackEvents, stalling: boolean): void {
    if (!this.settings.vibrationEnabled) return;
    const now = performance.now();

    if (haptics.scrapeIntensity > 0.05) {
      const mag = clamp(haptics.scrapeIntensity, 0.35, 1.0);
      this.impulseLockUntil = now + 220;
      this.triggerVibration(220, mag, mag * 0.82, true);
      return;
    }

    if (haptics.touchdownIntensity > 0.05) {
      const mag = clamp(haptics.touchdownIntensity, 0.28, 1.0);
      this.impulseLockUntil = now + 180;
      this.triggerVibration(180, mag * 0.9, mag * 0.62, true);
      return;
    }

    if (now < this.impulseLockUntil) return;

    this.rollRumbleTimer -= dt;
    if (this.rollRumbleTimer <= 0) {
      if (haptics.groundRollSpeedNorm > 0.08) {
        this.rollRumbleTimer = 0.09;
        const r = haptics.groundRollSpeedNorm;
        this.triggerVibration(95, r * 0.16, r * 0.36, false);
      } else if (stalling) {
        this.rollRumbleTimer = 0.14;
        this.triggerVibration(110, 0.12, 0.28, false);
      }
    }
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.activeSource = 'keyboard';

      if (e.code === 'KeyG') this.oneShotActions.toggleGear = true;
      if (e.code === 'KeyC') this.oneShotActions.switchCamera = true;
      if (e.code === 'KeyV') this.oneShotActions.cycleWeather = true;
      if (e.code === 'KeyT') this.oneShotActions.cycleTime = true;
      if (e.code === 'KeyZ') this.oneShotActions.toggleZoom = true;
      if (e.code === 'Backspace' || e.code === 'Backquote') this.oneShotActions.resetAircraft = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.oneShotActions.togglePause = true;
      if (e.code === 'KeyH') this.oneShotActions.cycleHud = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
    });
  }

  private bindPointerLook(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (this.pointerDraggingLook) return;
      this.pointerDraggingLook = true;
      this.lookPointerId = e.pointerId;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.pointerDraggingLook || e.pointerId !== this.lookPointerId) return;
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.lookAccumX += dx * 0.0036;
      this.lookAccumY += dy * 0.0036;
    });

    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookPointerId) {
        this.pointerDraggingLook = false;
        this.lookPointerId = null;
      }
    };
    window.addEventListener('pointerup', endLook);
    window.addEventListener('pointercancel', endLook);
  }

  private bindGamepadEvents(): void {
    window.addEventListener('gamepadconnected', (e) => {
      this.activeGamepadIndex = e.gamepad.index;
      this.prevBtnPressed = new Array(e.gamepad.buttons.length).fill(false);
      const label = this.identifyControllerProfile(e.gamepad).profileLabel;
      this.activeSource = 'gamepad';
      this.onConnectionChange?.(true, label);
      this.triggerVibration(110, 0.3, 0.45, false);
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      const label = this.identifyControllerProfile(e.gamepad).profileLabel;
      if (this.activeGamepadIndex === e.gamepad.index) {
        this.activeGamepadIndex = null;
      }
      this.onConnectionChange?.(false, label);
    });
  }

  public identifyControllerProfile(gp: Gamepad): { profileLabel: string; compatibilityNote: string } {
    const idLower = gp.id.toLowerCase();
    const isStandard = gp.mapping === 'standard';
    let profileLabel = 'Bluetooth / USB Gamepad';

    if (idLower.includes('054c') && (idLower.includes('0ce6') || idLower.includes('dualsense'))) {
      profileLabel = 'PlayStation DualSense Controller';
    } else if (
      idLower.includes('054c') ||
      idLower.includes('dualshock') ||
      idLower.includes('wireless controller')
    ) {
      profileLabel = 'PS4 DualShock 4 Controller';
    } else if (idLower.includes('xbox') || idLower.includes('045e') || idLower.includes('xinput')) {
      profileLabel = 'Xbox Wireless Controller';
    }

    const compatibilityNote = isStandard
      ? 'Standard W3C Gamepad mapping active (L1 Camera, R1 Weather, Full Menu Control).'
      : 'Non-standard controller mapping detected — customize axes/buttons below if needed.';

    return { profileLabel, compatibilityNote };
  }

  private findActiveGamepad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.activeGamepadIndex !== null && pads[this.activeGamepadIndex]?.connected) {
      return pads[this.activeGamepadIndex];
    }
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) {
        this.activeGamepadIndex = p.index;
        const label = this.identifyControllerProfile(p).profileLabel;
        this.onConnectionChange?.(true, label);
        return p;
      }
    }
    return null;
  }

  public getLiveGamepadSnapshot(): GamepadSnapshot {
    const gp = this.findActiveGamepad() as ExtendedGamepad | null;
    if (!gp) {
      return {
        connected: false,
        id: 'No controller detected',
        profileLabel: 'Not Connected',
        standardMapping: false,
        vibrationSupported: typeof navigator.vibrate === 'function',
        axes: [],
        buttons: [],
        compatibilityNote:
          'Press any button on a paired PS4, DualSense, Xbox, or Bluetooth controller to connect.',
      };
    }

    const info = this.identifyControllerProfile(gp as unknown as Gamepad);
    const vibSupported = Boolean(
      gp.vibrationActuator?.playEffect ||
        (gp.hapticActuators && gp.hapticActuators.length > 0) ||
        typeof navigator.vibrate === 'function'
    );

    return {
      connected: true,
      id: gp.id,
      profileLabel: info.profileLabel,
      standardMapping: gp.mapping === 'standard',
      vibrationSupported: vibSupported,
      axes: gp.axes.map((a) => Number(a.toFixed(3))),
      buttons: gp.buttons.map((b) => ({ pressed: b.pressed, value: Number(b.value.toFixed(2)) })),
      compatibilityNote: info.compatibilityNote,
    };
  }

  public calibrateGamepadCenters(): boolean {
    const gp = this.findActiveGamepad();
    if (!gp) return false;
    for (let i = 0; i < 4; i++) {
      this.settings.axisCenterOffsets[i] = gp.axes[i] ?? 0;
    }
    this.saveSettings();
    return true;
  }

  public listenForNextGamepadInput(
    kind: 'button' | 'axis',
    cb: (kind: 'button' | 'axis', index: number) => void
  ): void {
    this.remapCaptureCallback = (detectedKind, index) => {
      if (detectedKind === kind) {
        this.remapCaptureCallback = null;
        cb(detectedKind, index);
      }
    };
  }

  public cancelRemapListen(): void {
    this.remapCaptureCallback = null;
  }

  public triggerUiAction(action: keyof typeof this.oneShotActions): void {
    this.oneShotActions[action] = true;
  }

  public consumeHudCycle(): boolean {
    const v = this.oneShotActions.cycleHud;
    this.oneShotActions.cycleHud = false;
    return v;
  }

  public notifyTouchUsed(): void {
    this.touchActive = true;
    this.activeSource = 'touch';
  }

  private processAxis(raw: number, centerOffset = 0): number {
    const centered = raw - centerOffset;
    const dz = this.settings.deadzone;
    const abs = Math.abs(centered);
    if (abs <= dz) return 0;
    const norm = (abs - dz) / Math.max(1 - dz, 0.05);
    // Silky progressive flight stick response curve for micro-precision + crisp full deflection
    const curved = Math.pow(clamp(norm, 0, 1), 1.42) * this.settings.sensitivity;
    return clamp(Math.sign(centered) * curved, -1, 1);
  }

  public poll(inMenu = false): ControlInputs {
    let pitch = 0;
    let roll = 0;
    let yaw = 0;
    let throttleDelta = 0;
    let throttleDirect: number | null = null;
    let airbrake = false;

    const menuNav: MenuNavActions = {
      up: false,
      down: false,
      left: false,
      right: false,
      confirm: false,
      back: false,
      prevTab: false,
      nextTab: false,
    };

    if (this.keys.has('KeyW') || this.keys.has('ArrowDown')) pitch -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowUp')) pitch += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) roll -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) roll += 1;
    if (this.keys.has('KeyQ')) yaw -= 1;
    if (this.keys.has('KeyE')) yaw += 1;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('KeyR')) {
      throttleDelta += 1;
    }
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyF')) {
      throttleDelta -= 1;
    }
    if (this.keys.has('Space') || this.keys.has('KeyB')) {
      airbrake = true;
    }

    // Touch controls with smooth progressive response curve
    if (Math.abs(this.touchStickX) > 0.01 || Math.abs(this.touchStickY) > 0.01) {
      const curveX = Math.sign(this.touchStickX) * Math.pow(Math.abs(this.touchStickX), 1.28);
      const curveY = Math.sign(this.touchStickY) * Math.pow(Math.abs(this.touchStickY), 1.28);
      roll += curveX * this.settings.sensitivity;
      pitch += curveY * this.settings.sensitivity;
      this.activeSource = 'touch';
    }
    if (Math.abs(this.touchYaw) > 0.01) {
      yaw += this.touchYaw;
      this.activeSource = 'touch';
    }
    if (this.touchThrottleDirect !== null) {
      throttleDirect = this.touchThrottleDirect;
      this.activeSource = 'touch';
    }
    if (this.touchAirbrake) {
      airbrake = true;
    }

    const nowMs = performance.now();
    const gp = this.findActiveGamepad();
    if (gp) {
      const m = this.settings.mapping;

      if (this.remapCaptureCallback) {
        for (let b = 0; b < gp.buttons.length; b++) {
          if (gp.buttons[b].pressed && !this.prevBtnPressed[b]) {
            this.remapCaptureCallback('button', b);
            break;
          }
        }
        for (let a = 0; a < gp.axes.length; a++) {
          if (Math.abs(gp.axes[a] - (this.settings.axisCenterOffsets[a] || 0)) > 0.65) {
            this.remapCaptureCallback('axis', a);
            break;
          }
        }
      }

      const gpRoll = this.processAxis(
        gp.axes[m.rollAxis] ?? 0,
        this.settings.axisCenterOffsets[m.rollAxis] || 0
      );
      const gpPitch = this.processAxis(
        gp.axes[m.pitchAxis] ?? 0,
        this.settings.axisCenterOffsets[m.pitchAxis] || 0
      );
      const gpYaw = this.processAxis(
        gp.axes[m.yawAxis] ?? 0,
        this.settings.axisCenterOffsets[m.yawAxis] || 0
      );

      const rightStickY =
        gp.axes.length > 3
          ? this.processAxis(gp.axes[3] ?? 0, this.settings.axisCenterOffsets[3] || 0)
          : 0;

      if (!inMenu) {
        if (Math.abs(gpYaw) > 0.05) {
          this.lookAccumX += gpYaw * 0.026;
        }
        if (Math.abs(rightStickY) > 0.05) {
          this.lookAccumY += rightStickY * 0.024;
        }
      }

      const r2Val = gp.buttons[m.throttleUpBtn]?.value ?? 0;
      const l2Val = gp.buttons[m.throttleDownBtn]?.value ?? 0;

      if (
        Math.abs(gpRoll) > 0.02 ||
        Math.abs(gpPitch) > 0.02 ||
        Math.abs(gpYaw) > 0.02 ||
        r2Val > 0.05 ||
        l2Val > 0.05
      ) {
        this.activeSource = 'gamepad';
      }

      const checkJustPressed = (btnIdx: number): boolean => {
        const now = Boolean(gp.buttons[btnIdx]?.pressed);
        const was = Boolean(this.prevBtnPressed[btnIdx]);
        if (now) this.activeSource = 'gamepad';
        return now && !was;
      };

      if (checkJustPressed(m.pauseBtn)) this.oneShotActions.togglePause = true;

      if (inMenu) {
        // FULL CONTROLLER MENU NAVIGATION (hands-free!)
        if (checkJustPressed(12)) menuNav.up = true;
        if (checkJustPressed(13)) menuNav.down = true;
        if (checkJustPressed(14)) menuNav.left = true;
        if (checkJustPressed(15)) menuNav.right = true;
        if (checkJustPressed(m.gearBtn)) menuNav.confirm = true; // Cross / A
        if (checkJustPressed(m.resetBtn)) menuNav.back = true;   // Circle / B
        if (checkJustPressed(m.cameraBtn)) menuNav.prevTab = true; // L1
        if (checkJustPressed(m.weatherBtn)) menuNav.nextTab = true; // R1

        // Left stick navigation with clean repeat cooldown
        if (nowMs > this.stickNavCooldown) {
          if (gpPitch < -0.58) {
            menuNav.up = true;
            this.stickNavCooldown = nowMs + 210;
          } else if (gpPitch > 0.58) {
            menuNav.down = true;
            this.stickNavCooldown = nowMs + 210;
          } else if (gpRoll < -0.58) {
            menuNav.left = true;
            this.stickNavCooldown = nowMs + 210;
          } else if (gpRoll > 0.58) {
            menuNav.right = true;
            this.stickNavCooldown = nowMs + 210;
          }
        }
      } else {
        // FULL IN-FLIGHT CONTROLLER COMMANDS
        roll += gpRoll;
        pitch += gpPitch;
        yaw += gpYaw;
        throttleDelta += (r2Val - l2Val) * 1.18;

        if (gp.buttons[m.airbrakeBtn]?.pressed) {
          airbrake = true;
        }

        if (checkJustPressed(m.cameraBtn)) this.oneShotActions.switchCamera = true;    // L1 -> Camera
        if (checkJustPressed(m.weatherBtn)) this.oneShotActions.cycleWeather = true;   // R1 -> Weather
        if (checkJustPressed(m.timeBtn)) this.oneShotActions.cycleTime = true;         // Triangle/Y -> Time
        if (checkJustPressed(m.gearBtn)) this.oneShotActions.toggleGear = true;        // Cross/A -> Gear
        if (checkJustPressed(m.resetBtn)) this.oneShotActions.resetAircraft = true;    // Circle/B -> Reset
        if (checkJustPressed(m.hudBtn)) this.oneShotActions.cycleHud = true;           // Share/Select -> HUD
        if (checkJustPressed(m.zoomBtn)) this.oneShotActions.toggleZoom = true;        // R3 -> Camera Zoom
        if (checkJustPressed(12)) this.oneShotActions.cycleTime = true;                // D-Pad Up -> Time
        if (checkJustPressed(13)) this.oneShotActions.cycleWeather = true;             // D-Pad Down -> Weather
        if (checkJustPressed(14)) this.oneShotActions.cycleAircraft = true;            // D-Pad Left -> Aircraft
        if (checkJustPressed(15)) this.oneShotActions.cycleHud = true;                 // D-Pad Right -> HUD
      }

      for (let b = 0; b < gp.buttons.length; b++) {
        this.prevBtnPressed[b] = gp.buttons[b].pressed;
      }
    }

    if (this.settings.invertPitch) {
      pitch = -pitch;
    }

    const out: ControlInputs = {
      pitch: clamp(pitch, -1, 1),
      roll: clamp(roll, -1, 1),
      yaw: clamp(yaw, -1, 1),
      throttleDelta: clamp(throttleDelta, -1, 1),
      throttleDirect,
      airbrake,
      toggleGear: this.oneShotActions.toggleGear,
      switchCamera: this.oneShotActions.switchCamera,
      cycleWeather: this.oneShotActions.cycleWeather,
      cycleTime: this.oneShotActions.cycleTime,
      cycleAircraft: this.oneShotActions.cycleAircraft,
      toggleZoom: this.oneShotActions.toggleZoom,
      resetAircraft: this.oneShotActions.resetAircraft,
      togglePause: this.oneShotActions.togglePause,
      lookDeltaX: this.lookAccumX,
      lookDeltaY: this.lookAccumY,
      activeSource: this.activeSource,
      menuNav,
    };

    this.oneShotActions.toggleGear = false;
    this.oneShotActions.switchCamera = false;
    this.oneShotActions.cycleWeather = false;
    this.oneShotActions.cycleTime = false;
    this.oneShotActions.cycleAircraft = false;
    this.oneShotActions.toggleZoom = false;
    this.oneShotActions.resetAircraft = false;
    this.oneShotActions.togglePause = false;
    this.lookAccumX = 0;
    this.lookAccumY = 0;
    this.touchThrottleDirect = null;

    return out;
  }

  /** v3: human label for the gamepad button bound to an action */
  public getGamepadButtonLabel(action: keyof ControllerMapping): string {
    const idx = this.settings.mapping[action];
    const labels: Record<number, string> = {0:'✕',1:'○',2:'□',3:'△',4:'L1',5:'R1',6:'L2',7:'R2',8:'Share',9:'Options',10:'L3',11:'R3',12:'D↑',13:'D↓',14:'D←',15:'D→'};
    return labels[idx] ?? `B${idx}`;
  }
  public getActionGamepadLabel(action: string): string {
    const map: Record<string, keyof ControllerMapping> = { camera:'cameraBtn', weather:'weatherBtn', time:'timeBtn', gear:'gearBtn', airbrake:'airbrakeBtn', reset:'resetBtn', pause:'pauseBtn', hud:'hudBtn', zoom:'zoomBtn' };
    const k = map[action]; return k ? this.getGamepadButtonLabel(k) : '';
  }

  public isGamepadConnected(): boolean {
    return this.findActiveGamepad() !== null;
  }

  public isTouchDevice(): boolean {
    return (
      this.touchActive ||
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    );
  }
}
