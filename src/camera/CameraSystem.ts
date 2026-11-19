import * as THREE from 'three';
import { AircraftModel } from '../aircraft/AircraftModel';
import { CameraModeId, ControlInputs, FlightTelemetry } from '../types';
import { clamp } from '../utils/noise';

const CAMERA_ORDER: CameraModeId[] = ['chase', 'cinematic', 'cockpit', 'freelook'];

export const CAMERA_LABELS: Record<CameraModeId, string> = {
  chase: 'Chase View',
  cockpit: 'Cockpit View',
  cinematic: 'Cinematic Director',
  freelook: '360 Free-Look',
};

const ZOOM_TIERS: Array<{ label: string; mult: number }> = [
  { label: 'Close', mult: 0.92 },
  { label: 'Balanced', mult: 1.12 },
  { label: 'Wide', mult: 1.42 },
];

export class CameraSystem {
  public readonly camera: THREE.PerspectiveCamera;
  private mode: CameraModeId = 'chase';
  private zoomTierIndex = 0; // Default Close for crisp, heroic framing in landscape!

  private smoothedPos = new THREE.Vector3(0, 545, 495);
  private smoothedTarget = new THREE.Vector3(0, 540, 440);
  private smoothedUp = new THREE.Vector3(0, 1, 0);
  private initialized = false;

  // Free-look & Cockpit look offsets
  private orbitYaw = 0.42;
  private orbitPitch = 0.22;
  private orbitDistance = 16.5;
  private cockpitYaw = 0;
  private cockpitPitch = -0.03;

  // Cinematic auto-director state
  private directorTimer = 0;
  private directorShotIndex = 0;

  // Opening menu gentle showcase orbit
  private menuShowcaseAngle = 0;

  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly desiredUp = new THREE.Vector3();
  private readonly rightVec = new THREE.Vector3();

  constructor(aspect: number) {
    const initialFov = aspect > 1.35 ? 49 : 56;
    this.camera = new THREE.PerspectiveCamera(initialFov, aspect, 0.3, 36000);
  }

  private isLandscape(): boolean {
    return this.camera.aspect > 1.35;
  }

  private getLandscapeScale(): number {
    // Pull camera significantly closer in wide landscape aspect ratios (e.g. 16:9, 20:9 mobile)
    // so the aircraft stays large, crisp, and detailed instead of tiny and distant!
    const a = this.camera.aspect;
    if (a <= 1.2) return 1.0;
    const t = clamp((a - 1.2) / 0.95, 0, 1);
    return THREE.MathUtils.lerp(1.0, 0.66, t);
  }

  private updateFovForMode(): void {
    const land = this.isLandscape();
    if (this.mode === 'cockpit') {
      this.camera.fov = land ? 62 : 66;
    } else if (this.mode === 'cinematic') {
      this.camera.fov = land ? 54 : 60;
    } else if (this.mode === 'freelook') {
      this.camera.fov = land ? 50 : 56;
    } else {
      this.camera.fov = land ? 49 : 55;
    }
    this.camera.updateProjectionMatrix();
  }

  public getMode(): CameraModeId {
    return this.mode;
  }

  public setMode(mode: CameraModeId): void {
    this.mode = mode;
    if (mode === 'cockpit') {
      this.cockpitYaw = 0;
      this.cockpitPitch = -0.03;
    } else if (mode === 'cinematic') {
      this.directorTimer = 0;
    }
    this.updateFovForMode();
  }

  public cycleMode(): CameraModeId {
    const idx = CAMERA_ORDER.indexOf(this.mode);
    const next = CAMERA_ORDER[(idx + 1) % CAMERA_ORDER.length];
    this.setMode(next);
    return next;
  }

  public cycleZoomPreset(): string {
    this.zoomTierIndex = (this.zoomTierIndex + 1) % ZOOM_TIERS.length;
    return ZOOM_TIERS[this.zoomTierIndex].label;
  }

  public adjustOrbitZoom(delta: number): void {
    this.orbitDistance = clamp(this.orbitDistance + delta, 10, 34);
  }

  public snapToAircraft(telemetry: FlightTelemetry): void {
    this.initialized = false;
    const backDist = 17.5 * this.getLandscapeScale() * ZOOM_TIERS[this.zoomTierIndex].mult;
    this.smoothedPos
      .copy(telemetry.position)
      .addScaledVector(telemetry.forward, -backDist)
      .add(new THREE.Vector3(0, 4.2 * this.getLandscapeScale(), 0));
    this.smoothedTarget.copy(telemetry.position).addScaledVector(telemetry.forward, 18);
    this.smoothedUp.set(0, 1, 0);
  }

  public resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.updateFovForMode();
  }

  public update(
    rawDt: number,
    telemetry: FlightTelemetry,
    aircraft: AircraftModel,
    inputs: ControlInputs,
    inMenuShowcase: boolean
  ): void {
    const dt = Math.min(rawDt, 0.05);
    this.rightVec.crossVectors(telemetry.forward, telemetry.up).normalize();
    const landScale = this.getLandscapeScale();
    const zoomMult = ZOOM_TIERS[this.zoomTierIndex].mult;

    if (inMenuShowcase) {
      this.menuShowcaseAngle += dt * 0.09;
      const gentleSwayX = (Math.sin(this.menuShowcaseAngle) * 4.0 - 4.2) * landScale;
      const gentleSwayY = (5.4 + Math.cos(this.menuShowcaseAngle * 0.8) * 1.1) * landScale;
      const back = 19.5 * landScale;

      this.desiredPos
        .copy(telemetry.position)
        .addScaledVector(telemetry.forward, -back)
        .addScaledVector(this.rightVec, gentleSwayX)
        .add(new THREE.Vector3(0, gentleSwayY, 0));

      this.desiredTarget
        .copy(telemetry.position)
        .addScaledVector(telemetry.forward, 26)
        .add(new THREE.Vector3(1.8, 2.8, 0));

      this.camera.position.lerp(this.desiredPos, Math.min(1, dt * 4.5));
      this.smoothedTarget.lerp(this.desiredTarget, Math.min(1, dt * 4.5));
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.smoothedTarget);
      return;
    }

    if (this.mode === 'cockpit') {
      this.cockpitYaw = clamp(this.cockpitYaw - inputs.lookDeltaX * 1.8, -1.35, 1.35);
      this.cockpitPitch = clamp(this.cockpitPitch - inputs.lookDeltaY * 1.4, -0.75, 0.85);
      if (Math.abs(inputs.lookDeltaX) < 0.0001 && Math.abs(inputs.lookDeltaY) < 0.0001) {
        this.cockpitYaw *= Math.max(0, 1 - dt * 0.8);
      }

      aircraft.cockpitAnchor.getWorldPosition(this.desiredPos);
      this.desiredPos.addScaledVector(telemetry.up, clamp((1 - telemetry.gForce) * 0.04, -0.08, 0.08));

      const lookDir = telemetry.forward.clone();
      lookDir.applyAxisAngle(telemetry.up, this.cockpitYaw);
      lookDir.applyAxisAngle(this.rightVec, this.cockpitPitch);

      this.desiredTarget.copy(this.desiredPos).addScaledVector(lookDir, 50);

      this.camera.position.copy(this.desiredPos);
      this.smoothedUp.lerp(telemetry.up, Math.min(1, dt * 10));
      this.camera.up.copy(this.smoothedUp).normalize();
      this.camera.lookAt(this.desiredTarget);
      return;
    }

    if (this.mode === 'freelook') {
      this.orbitYaw -= inputs.lookDeltaX * 2.6;
      this.orbitPitch = clamp(this.orbitPitch + inputs.lookDeltaY * 2.1, -0.42, 1.25);

      const dist = this.orbitDistance * landScale * zoomMult;
      const cosP = Math.cos(this.orbitPitch);
      const offset = new THREE.Vector3(
        Math.sin(this.orbitYaw) * cosP * dist,
        Math.sin(this.orbitPitch) * dist,
        Math.cos(this.orbitYaw) * cosP * dist
      );

      this.desiredPos.copy(telemetry.position).add(offset);
      this.desiredTarget.copy(telemetry.position).add(new THREE.Vector3(0, 0.6, 0));

      const blend = this.initialized ? Math.min(1, dt * 9.5) : 1.0;
      this.smoothedPos.lerp(this.desiredPos, blend);
      this.smoothedTarget.lerp(this.desiredTarget, blend);
      this.camera.position.copy(this.smoothedPos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.smoothedTarget);
      this.initialized = true;
      return;
    }

    if (this.mode === 'cinematic') {
      this.directorTimer += dt;
      if (this.directorTimer > 11.0) {
        this.directorTimer = 0;
        this.directorShotIndex = (this.directorShotIndex + 1) % 3;
      }

      const cs = landScale * zoomMult;
      if (this.directorShotIndex === 0) {
        this.desiredPos
          .copy(telemetry.position)
          .addScaledVector(telemetry.forward, -24 * cs)
          .addScaledVector(this.rightVec, -6.5 * cs)
          .add(new THREE.Vector3(0, 6.8 * cs, 0));
        this.desiredTarget
          .copy(telemetry.position)
          .addScaledVector(telemetry.forward, 30)
          .add(new THREE.Vector3(0, 2.2, 0));
      } else if (this.directorShotIndex === 1) {
        this.desiredPos
          .copy(telemetry.position)
          .addScaledVector(telemetry.forward, -10.5 * cs)
          .addScaledVector(this.rightVec, 11.5 * cs)
          .add(new THREE.Vector3(0, 3.2 * cs, 0));
        this.desiredTarget
          .copy(telemetry.position)
          .addScaledVector(telemetry.forward, 18)
          .add(new THREE.Vector3(0, 1.0, 0));
      } else {
        this.desiredPos
          .copy(telemetry.position)
          .addScaledVector(telemetry.forward, -19.5 * cs)
          .addScaledVector(this.rightVec, 4.2 * cs)
          .add(new THREE.Vector3(0, 2.0 * cs, 0));
        this.desiredTarget
          .copy(telemetry.position)
          .addScaledVector(telemetry.forward, 26)
          .add(new THREE.Vector3(0, 4.5, 0));
      }

      const blend = this.initialized ? Math.min(1, dt * 3.0) : 1.0;
      this.smoothedPos.lerp(this.desiredPos, blend);
      this.smoothedTarget.lerp(this.desiredTarget, blend);
      this.desiredUp.set(0, 1, 0).lerp(telemetry.up, 0.14).normalize();
      this.smoothedUp.lerp(this.desiredUp, Math.min(1, dt * 3.0)).normalize();

      this.camera.position.copy(this.smoothedPos);
      this.camera.up.copy(this.smoothedUp);
      this.camera.lookAt(this.smoothedTarget);
      this.initialized = true;
      return;
    }

    // DEFAULT: Landscape-tuned Close-Up Critically-Damped Third-Person Chase Camera
    const bankRad = THREE.MathUtils.degToRad(telemetry.rollDeg);
    const speedZoom = clamp((telemetry.airspeedKts - 60) / 120, 0, 1) * 2.1;
    const followBack = (17.2 + speedZoom) * landScale * zoomMult;
    const followUp = 4.3 * landScale * zoomMult;
    const turnLeadX = -Math.sin(bankRad) * 2.4 * landScale;

    this.desiredPos
      .copy(telemetry.position)
      .addScaledVector(telemetry.forward, -followBack)
      .addScaledVector(this.rightVec, turnLeadX * 0.42)
      .add(new THREE.Vector3(0, followUp * 0.65, 0))
      .addScaledVector(telemetry.up, followUp * 0.35);

    this.desiredTarget
      .copy(telemetry.position)
      .addScaledVector(telemetry.forward, 24)
      .addScaledVector(this.rightVec, turnLeadX)
      .add(new THREE.Vector3(0, 1.35, 0));

    this.desiredUp.set(0, 1, 0).lerp(telemetry.up, 0.22).normalize();

    const posBlend = this.initialized ? 1 - Math.exp(-7.4 * dt) : 1.0;
    const tgtBlend = this.initialized ? 1 - Math.exp(-10.2 * dt) : 1.0;

    this.smoothedPos.lerp(this.desiredPos, posBlend);
    this.smoothedTarget.lerp(this.desiredTarget, tgtBlend);
    this.smoothedUp.lerp(this.desiredUp, posBlend).normalize();

    this.camera.position.copy(this.smoothedPos);
    this.camera.up.copy(this.smoothedUp);
    this.camera.lookAt(this.smoothedTarget);
    this.initialized = true;
  }
}
