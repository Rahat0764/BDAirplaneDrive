import * as THREE from 'three';
import { AircraftModel } from '../aircraft/AircraftModel';
import { CameraModeId, ControlInputs, FlightTelemetry } from '../types';
import { clamp } from '../utils/noise';

const CAMERA_ORDER: CameraModeId[] = ['chase', 'cinematic', 'cockpit', 'freelook'];

export const CAMERA_LABELS: Record<CameraModeId, string> = {
  chase: 'Chase View',
  cockpit: 'Cockpit View',
  cinematic: 'Cinematic Director',
  freelook: '360° Free-Look',
};

export class CameraSystem {
  public readonly camera: THREE.PerspectiveCamera;
  private mode: CameraModeId = 'chase';

  private smoothedPos = new THREE.Vector3(0, 550, 505);
  private smoothedTarget = new THREE.Vector3(0, 540, 440);
  private smoothedUp = new THREE.Vector3(0, 1, 0);
  private initialized = false;

  // Free-look & Cockpit look offsets
  private orbitYaw = 0.42;
  private orbitPitch = 0.24;
  private orbitDistance = 24;
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
    this.camera = new THREE.PerspectiveCamera(56, aspect, 0.35, 34000);
  }

  public getMode(): CameraModeId {
    return this.mode;
  }

  public setMode(mode: CameraModeId): void {
    this.mode = mode;
    if (mode === 'cockpit') {
      this.camera.fov = 66;
      this.cockpitYaw = 0;
      this.cockpitPitch = -0.03;
    } else if (mode === 'cinematic') {
      this.camera.fov = 64;
      this.directorTimer = 0;
    } else if (mode === 'freelook') {
      this.camera.fov = 56;
    } else {
      // Wide-enough chase framing so aircraft feels gracefully small amidst gigantic cloud towers!
      this.camera.fov = 56;
    }
    this.camera.updateProjectionMatrix();
  }

  public cycleMode(): CameraModeId {
    const idx = CAMERA_ORDER.indexOf(this.mode);
    const next = CAMERA_ORDER[(idx + 1) % CAMERA_ORDER.length];
    this.setMode(next);
    return next;
  }

  public snapToAircraft(telemetry: FlightTelemetry): void {
    this.initialized = false;
    this.smoothedPos.copy(telemetry.position).addScaledVector(telemetry.forward, -23).add(new THREE.Vector3(0, 6.2, 0));
    this.smoothedTarget.copy(telemetry.position).addScaledVector(telemetry.forward, 18);
    this.smoothedUp.set(0, 1, 0);
  }

  public resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
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

    if (inMenuShowcase) {
      // Breathtaking opening shot inspired directly by ref.mp4:
      // Slightly elevated rear-left-quarter perspective showing the white & crimson aircraft
      // banking peacefully into the massive cumulus cloud canyon with the Moon & valley ahead!
      this.menuShowcaseAngle += dt * 0.09;
      const gentleSwayX = Math.sin(this.menuShowcaseAngle) * 5.2 - 5.5;
      const gentleSwayY = 6.8 + Math.cos(this.menuShowcaseAngle * 0.8) * 1.4;

      this.desiredPos
        .copy(telemetry.position)
        .addScaledVector(telemetry.forward, -24.5)
        .addScaledVector(this.rightVec, gentleSwayX)
        .add(new THREE.Vector3(0, gentleSwayY, 0));

      this.desiredTarget
        .copy(telemetry.position)
        .addScaledVector(telemetry.forward, 32)
        .add(new THREE.Vector3(2.5, 4.0, 0));

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
        // Gently recenter cockpit gaze
        this.cockpitYaw *= Math.max(0, 1 - dt * 0.8);
      }

      aircraft.cockpitAnchor.getWorldPosition(this.desiredPos);
      // Subtle head sway with G-force & roll
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
      this.orbitPitch = clamp(this.orbitPitch + inputs.lookDeltaY * 2.1, -0.45, 1.25);

      const cosP = Math.cos(this.orbitPitch);
      const offset = new THREE.Vector3(
        Math.sin(this.orbitYaw) * cosP * this.orbitDistance,
        Math.sin(this.orbitPitch) * this.orbitDistance,
        Math.cos(this.orbitYaw) * cosP * this.orbitDistance
      );

      this.desiredPos.copy(telemetry.position).add(offset);
      this.desiredTarget.copy(telemetry.position).add(new THREE.Vector3(0, 0.8, 0));

      const blend = this.initialized ? Math.min(1, dt * 9.0) : 1.0;
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
      if (this.directorTimer > 11.5) {
        this.directorTimer = 0;
        this.directorShotIndex = (this.directorShotIndex + 1) % 3;
      }

      if (this.directorShotIndex === 0) {
        // Wide Majestic Cloud-Canyon High Chase (aircraft small against colossal clouds!)
        this.desiredPos
          .copy(telemetry.position)
          .addScaledVector(telemetry.forward, -34)
          .addScaledVector(this.rightVec, -8.5)
          .add(new THREE.Vector3(0, 9.5, 0));
        this.desiredTarget
          .copy(telemetry.position)
          .addScaledVector(telemetry.forward, 38)
          .add(new THREE.Vector3(0, 3.5, 0));
      } else if (this.directorShotIndex === 1) {
        // Dramatic Starboard Wing-Side Panoramic Shot
        this.desiredPos
          .copy(telemetry.position)
          .addScaledVector(telemetry.forward, -14)
          .addScaledVector(this.rightVec, 15.5)
          .add(new THREE.Vector3(0, 4.2, 0));
        this.desiredTarget
          .copy(telemetry.position)
          .addScaledVector(telemetry.forward, 22)
          .add(new THREE.Vector3(0, 1.5, 0));
      } else {
        // Sweeping Low-Horizon Upward Cloud Cathedral Angle
        this.desiredPos
          .copy(telemetry.position)
          .addScaledVector(telemetry.forward, -27)
          .addScaledVector(this.rightVec, 5.5)
          .add(new THREE.Vector3(0, 2.2, 0));
        this.desiredTarget
          .copy(telemetry.position)
          .addScaledVector(telemetry.forward, 30)
          .add(new THREE.Vector3(0, 6.2, 0));
      }

      const blend = this.initialized ? Math.min(1, dt * 2.8) : 1.0;
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

    // DEFAULT: Smooth Critically-Damped Third-Person Chase Camera
    const bankRad = THREE.MathUtils.degToRad(telemetry.rollDeg);
    const speedZoom = clamp((telemetry.airspeedKts - 60) / 110, 0, 1) * 3.2;
    const followBack = 21.5 + speedZoom;
    const followUp = 5.4;
    const turnLeadX = -Math.sin(bankRad) * 3.2;

    this.desiredPos
      .copy(telemetry.position)
      .addScaledVector(telemetry.forward, -followBack)
      .addScaledVector(this.rightVec, turnLeadX * 0.45)
      .add(new THREE.Vector3(0, followUp * 0.65, 0))
      .addScaledVector(telemetry.up, followUp * 0.35);

    this.desiredTarget
      .copy(telemetry.position)
      .addScaledVector(telemetry.forward, 26)
      .addScaledVector(this.rightVec, turnLeadX)
      .add(new THREE.Vector3(0, 1.8, 0));

    // Subtle horizon-coupled bank roll (22% of aircraft roll) so banking feels silky & immersive without disorienting!
    this.desiredUp.set(0, 1, 0).lerp(telemetry.up, 0.22).normalize();

    const posBlend = this.initialized ? 1 - Math.exp(-6.8 * dt) : 1.0;
    const tgtBlend = this.initialized ? 1 - Math.exp(-9.5 * dt) : 1.0;

    this.smoothedPos.lerp(this.desiredPos, posBlend);
    this.smoothedTarget.lerp(this.desiredTarget, tgtBlend);
    this.smoothedUp.lerp(this.desiredUp, posBlend).normalize();

    this.camera.position.copy(this.smoothedPos);
    this.camera.up.copy(this.smoothedUp);
    this.camera.lookAt(this.smoothedTarget);
    this.initialized = true;
  }
}
