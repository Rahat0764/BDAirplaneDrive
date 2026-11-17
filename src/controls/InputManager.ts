import { ControlInputs, ControllerMapping, ControllerSettings } from '../types';
import { clamp } from '../utils/noise';

const STORAGE_KEY = 'dream_flight_controller_v1';

export const DEFAULT_CONTROLLER_MAPPING: ControllerMapping = {
  pitchAxis: 1,       // Left Stick Vertical
  rollAxis: 0,        // Left Stick Horizontal
  yawAxis: 2,         // Right Stick Horizontal (Standard mapping)
  throttleUpBtn: 7,   // R2 / RT
  throttleDownBtn: 6, // L2 / LT
  cameraBtn: 3,       // Triangle / Y
  gearBtn: 0,         // Cross / A
  airbrakeBtn: 2,     // Square / X
  resetBtn: 1,        // Circle / B
  pauseBtn: 9,        // Options / Start
};

export interface GamepadSnapshot {
  connected: boolean;
  id: string;
  profileLabel: string;
  standardMapping: boolean;
  axes: number[];
  buttons: Array<{ pressed: boolean; value: number }>;
  compatibilityNote: string;
}

export class InputManager {
  public settings: ControllerSettings = {
    deadzone: 0.12,
    sensitivity: 1.0,
    invertPitch: false,
    axisCenterOffsets: [0, 0, 0, 0],
    mapping: { ...DEFAULT_CONTROLLER_MAPPING },
  };

  private keys = new Set<string>();
  private oneShotActions = {
    toggleGear: false,
    switchCamera: false,
    resetAircraft: false,
    togglePause: false,
    cycleHud: false,
  };

  // Touch inputs populated by UIManager virtual stick & sliders
  public touchStickX = 0;
  public touchStickY = 0;
  public touchThrottleDirect: number | null = null;
  public touchAirbrake = false;
  private touchActive = false;

  // Mouse / touch look delta
  private lookAccumX = 0;
  private lookAccumY = 0;
  private pointerDraggingLook = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  // Gamepad tracking
  private activeGamepadIndex: number | null = null;
  private prevBtnPressed: boolean[] = [];
  private activeSource: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  private onConnectionChange?: (connected: boolean, label: string) => void;
  private remapCaptureCallback: ((kind: 'button' | 'axis', index: number) => void) | null = null;

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
      // Ignore storage access errors in private browsing
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
      deadzone: 0.12,
      sensitivity: 1.0,
      invertPitch: false,
      axisCenterOffsets: [0, 0, 0, 0],
      mapping: { ...DEFAULT_CONTROLLER_MAPPING },
    };
    this.saveSettings();
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.activeSource = 'keyboard';

      if (e.code === 'KeyG') this.oneShotActions.toggleGear = true;
      if (e.code === 'KeyC') this.oneShotActions.switchCamera = true;
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
      this.pointerDraggingLook = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.pointerDraggingLook) return;
      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.lookAccumX += dx * 0.0032;
      this.lookAccumY += dy * 0.0032;
    });

    window.addEventListener('pointerup', () => {
      this.pointerDraggingLook = false;
    });
    window.addEventListener('pointercancel', () => {
      this.pointerDraggingLook = false;
    });
  }

  private bindGamepadEvents(): void {
    window.addEventListener('gamepadconnected', (e) => {
      this.activeGamepadIndex = e.gamepad.index;
      this.prevBtnPressed = new Array(e.gamepad.buttons.length).fill(false);
      const label = this.identifyControllerProfile(e.gamepad).profileLabel;
      this.activeSource = 'gamepad';
      this.onConnectionChange?.(true, label);
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
      ? 'Standard W3C Gamepad mapping detected.'
      : 'Non-standard OS/Android browser mapping detected — use Controller Test & Custom Mapping below if any axis/button differs on your device.';

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
    const gp = this.findActiveGamepad();
    if (!gp) {
      return {
        connected: false,
        id: 'No controller detected',
        profileLabel: 'Not Connected',
        standardMapping: false,
        axes: [],
        buttons: [],
        compatibilityNote:
          'Press any button on a paired PS4 DualShock 4 or Bluetooth controller to wake it in your browser.',
      };
    }

    const info = this.identifyControllerProfile(gp);
    return {
      connected: true,
      id: gp.id,
      profileLabel: info.profileLabel,
      standardMapping: gp.mapping === 'standard',
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
    const curved = Math.pow(clamp(norm, 0, 1), 1.35) * this.settings.sensitivity;
    return clamp(Math.sign(centered) * curved, -1, 1);
  }

  public poll(): ControlInputs {
    let pitch = 0;
    let roll = 0;
    let yaw = 0;
    let throttleDelta = 0;
    let throttleDirect: number | null = null;
    let airbrake = false;

    // 1. Keyboard inputs
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

    // 2. Touch virtual joystick & throttle slider
    if (Math.abs(this.touchStickX) > 0.01 || Math.abs(this.touchStickY) > 0.01) {
      roll += this.touchStickX * this.settings.sensitivity;
      pitch += this.touchStickY * this.settings.sensitivity;
      this.activeSource = 'touch';
    }
    if (this.touchThrottleDirect !== null) {
      throttleDirect = this.touchThrottleDirect;
      this.activeSource = 'touch';
    }
    if (this.touchAirbrake) {
      airbrake = true;
    }

    // 3. PS4 DualShock 4 / DualSense / Bluetooth Gamepad API
    const gp = this.findActiveGamepad();
    if (gp) {
      const m = this.settings.mapping;

      // Capture mode for custom button/axis mapping UI
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

      // Right stick vertical can also pan free-look / cockpit pitch when axis 3 exists
      const rightStickY = gp.axes.length > 3 ? this.processAxis(gp.axes[3] ?? 0, this.settings.axisCenterOffsets[3] || 0) : 0;
      if (Math.abs(rightStickY) > 0.05) {
        this.lookAccumY += rightStickY * 0.022;
      }

      const r2Val = gp.buttons[m.throttleUpBtn]?.value ?? 0;
      const l2Val = gp.buttons[m.throttleDownBtn]?.value ?? 0;

      if (Math.abs(gpRoll) > 0.01 || Math.abs(gpPitch) > 0.01 || Math.abs(gpYaw) > 0.01 || r2Val > 0.05 || l2Val > 0.05) {
        this.activeSource = 'gamepad';
      }

      roll += gpRoll;
      pitch += gpPitch; // Pulling stick back (+1 on standard Y axis) pitches nose up!
      yaw += gpYaw;
      throttleDelta += (r2Val - l2Val) * 1.15;

      if (gp.buttons[m.airbrakeBtn]?.pressed) {
        airbrake = true;
      }

      // Edge-triggered button actions
      const checkJustPressed = (btnIdx: number): boolean => {
        const now = Boolean(gp.buttons[btnIdx]?.pressed);
        const was = Boolean(this.prevBtnPressed[btnIdx]);
        return now && !was;
      };

      if (checkJustPressed(m.cameraBtn)) this.oneShotActions.switchCamera = true;
      if (checkJustPressed(m.gearBtn)) this.oneShotActions.toggleGear = true;
      if (checkJustPressed(m.resetBtn)) this.oneShotActions.resetAircraft = true;
      if (checkJustPressed(m.pauseBtn)) this.oneShotActions.togglePause = true;

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
      resetAircraft: this.oneShotActions.resetAircraft,
      togglePause: this.oneShotActions.togglePause,
      lookDeltaX: this.lookAccumX,
      lookDeltaY: this.lookAccumY,
      activeSource: this.activeSource,
    };

    // Reset one-frame deltas
    this.oneShotActions.toggleGear = false;
    this.oneShotActions.switchCamera = false;
    this.oneShotActions.resetAircraft = false;
    this.oneShotActions.togglePause = false;
    this.lookAccumX = 0;
    this.lookAccumY = 0;
    this.touchThrottleDirect = null;

    return out;
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
