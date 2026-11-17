import * as THREE from 'three';
import { AIRCRAFT_SPECS } from '../aircraft/AircraftModel';
import {
  AircraftVariantId,
  ControlInputs,
  FlightAssistOptions,
  FlightTelemetry,
} from '../types';
import { clamp, noise2D } from '../utils/noise';

const KTS_PER_MS = 1.94384;
const MS_PER_KTS = 1 / KTS_PER_MS;
const FT_PER_M = 3.28084;
const GRAVITY = 9.81;

export interface SpawnPreset {
  position: THREE.Vector3;
  headingDeg: number;
  pitchDeg: number;
  airspeedKts: number;
  throttle: number;
  gearDown: boolean;
  onGround: boolean;
}

export class FlightPhysics {
  public readonly telemetry: FlightTelemetry;

  private options: FlightAssistOptions = {
    flightMode: 'relaxed',
    altitudeAssist: false,
    collisionDamage: false,
    stallSimulation: true,
  };

  private variant: AircraftVariantId = 'cloudrunner';
  private smoothedPitchIn = 0;
  private smoothedRollIn = 0;
  private smoothedYawIn = 0;
  private turbulenceClock = 0;
  private crashCooldown = 0;
  private wasOnGround = false;
  private scrapeCooldown = 0;

  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpVelDir = new THREE.Vector3();
  private readonly tmpForce = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.telemetry = {
      position: new THREE.Vector3(0, 540, 480),
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(0, 0, -58),
      forward: new THREE.Vector3(0, 0, -1),
      up: new THREE.Vector3(0, 1, 0),
      airspeedMs: 58,
      airspeedKts: 58 * KTS_PER_MS,
      altitudeM: 540,
      altitudeFt: 540 * FT_PER_M,
      aglM: 510,
      verticalSpeedFpm: 0,
      headingDeg: 0,
      pitchDeg: 0,
      rollDeg: 0,
      throttle: 0.68,
      rpmNormalized: 0.72,
      gearDown: true,
      gearDeployAnim: 1.0,
      airbrakeActive: false,
      airbrakeAnim: 0.0,
      onGround: false,
      surfaceType: 'air',
      stalling: false,
      crashed: false,
      cloudDensity: 0,
      gForce: 1.0,
      aileronInput: 0,
      elevatorInput: 0,
      rudderInput: 0,
      haptics: {
        touchdownIntensity: 0,
        scrapeIntensity: 0,
        groundRollSpeedNorm: 0,
      },
    };

    this.spawn({
      position: new THREE.Vector3(-12, 540, 480),
      headingDeg: 356,
      pitchDeg: 1.5,
      airspeedKts: 112,
      throttle: 0.68,
      gearDown: true,
      onGround: false,
    });
  }

  public setVariant(variant: AircraftVariantId): void {
    this.variant = variant;
  }

  public setAssistOptions(partial: Partial<FlightAssistOptions>): void {
    this.options = { ...this.options, ...partial };
  }

  public getAssistOptions(): FlightAssistOptions {
    return { ...this.options };
  }

  public spawn(preset: SpawnPreset): void {
    const t = this.telemetry;
    t.position.copy(preset.position);

    const yawRad = THREE.MathUtils.degToRad(-preset.headingDeg);
    const pitchRad = THREE.MathUtils.degToRad(preset.pitchDeg);
    this.tmpEuler.set(pitchRad, yawRad, 0, 'YXZ');
    t.quaternion.setFromEuler(this.tmpEuler);

    t.forward.set(0, 0, -1).applyQuaternion(t.quaternion).normalize();
    t.up.set(0, 1, 0).applyQuaternion(t.quaternion).normalize();

    const speedMs = preset.airspeedKts * MS_PER_KTS;
    t.velocity.copy(t.forward).multiplyScalar(speedMs);
    t.airspeedMs = speedMs;
    t.airspeedKts = preset.airspeedKts;
    t.altitudeM = preset.position.y;
    t.altitudeFt = preset.position.y * FT_PER_M;
    t.verticalSpeedFpm = 0;
    t.headingDeg = ((preset.headingDeg % 360) + 360) % 360;
    t.pitchDeg = preset.pitchDeg;
    t.rollDeg = 0;
    t.throttle = preset.throttle;
    t.rpmNormalized = clamp(0.2 + preset.throttle * 0.8, 0, 1);
    t.gearDown = preset.gearDown;
    t.gearDeployAnim = preset.gearDown ? 1.0 : 0.0;
    t.airbrakeActive = false;
    t.airbrakeAnim = 0;
    t.onGround = preset.onGround;
    t.surfaceType = preset.onGround ? 'runway' : 'air';
    t.stalling = false;
    t.crashed = false;
    t.gForce = 1.0;
    t.haptics.touchdownIntensity = 0;
    t.haptics.scrapeIntensity = 0;
    t.haptics.groundRollSpeedNorm = 0;

    this.wasOnGround = preset.onGround;
    this.smoothedPitchIn = 0;
    this.smoothedRollIn = 0;
    this.smoothedYawIn = 0;
    this.crashCooldown = 0;
  }

  public update(
    rawDt: number,
    inputs: ControlInputs,
    getTerrainHeight: (x: number, z: number) => number,
    getWaterSurfaceHeight: (x: number, z: number) => number | null,
    classifySurface: (x: number, z: number) => 'runway' | 'highway' | 'water' | 'terrain',
    cloudDensity: number
  ): void {
    const dt = Math.min(rawDt, 0.05);
    const t = this.telemetry;
    const spec = AIRCRAFT_SPECS[this.variant];
    const isRelaxed = this.options.flightMode === 'relaxed';

    // Reset per-frame haptic impulse triggers
    t.haptics.touchdownIntensity = 0;
    t.haptics.scrapeIntensity = 0;
    t.haptics.groundRollSpeedNorm = 0;
    if (this.scrapeCooldown > 0) this.scrapeCooldown -= dt;

    t.cloudDensity = cloudDensity;

    if (t.crashed) {
      this.crashCooldown -= dt;
      if (inputs.resetAircraft || this.crashCooldown <= 0) {
        this.recoverInAir();
      }
      return;
    }

    if (inputs.toggleGear && !t.onGround) {
      t.gearDown = !t.gearDown;
    }
    const targetGear = t.gearDown ? 1.0 : 0.0;
    t.gearDeployAnim += (targetGear - t.gearDeployAnim) * Math.min(1, dt * 2.8);

    t.airbrakeActive = inputs.airbrake;
    const targetBrake = t.airbrakeActive ? 1.0 : 0.0;
    t.airbrakeAnim += (targetBrake - t.airbrakeAnim) * Math.min(1, dt * 6.0);

    if (inputs.throttleDirect !== null) {
      t.throttle = clamp(inputs.throttleDirect, 0, 1);
    } else if (Math.abs(inputs.throttleDelta) > 0.001) {
      t.throttle = clamp(t.throttle + inputs.throttleDelta * dt * 0.55, 0, 1);
    }

    const targetRpm = clamp(0.18 + t.throttle * 0.82 + (t.airspeedMs / 95) * 0.08, 0.15, 1.05);
    t.rpmNormalized += (targetRpm - t.rpmNormalized) * Math.min(1, dt * 3.5);

    const smoothRate = isRelaxed ? 7.5 : 11.5;
    this.smoothedPitchIn += (inputs.pitch - this.smoothedPitchIn) * Math.min(1, dt * smoothRate);
    this.smoothedRollIn += (inputs.roll - this.smoothedRollIn) * Math.min(1, dt * smoothRate);
    this.smoothedYawIn += (inputs.yaw - this.smoothedYawIn) * Math.min(1, dt * smoothRate);

    t.aileronInput = this.smoothedRollIn;
    t.elevatorInput = this.smoothedPitchIn;
    t.rudderInput = this.smoothedYawIn;

    this.tmpForward.set(0, 0, -1).applyQuaternion(t.quaternion).normalize();
    this.tmpRight.set(1, 0, 0).applyQuaternion(t.quaternion).normalize();
    this.tmpUp.set(0, 1, 0).applyQuaternion(t.quaternion).normalize();

    this.tmpEuler.setFromQuaternion(t.quaternion, 'YXZ');
    const currentPitchRad = this.tmpEuler.x;
    const currentRollRad = -Math.asin(clamp(this.tmpRight.y, -1, 1));

    const stallMs = spec.stallSpeedKts * MS_PER_KTS;
    const cruiseMs = spec.cruiseSpeedKts * MS_PER_KTS;
    const maxMs = spec.maxSpeedKts * MS_PER_KTS;
    const speedAuthority = clamp(t.airspeedMs / (stallMs * 1.15), 0.22, 1.25);

    let pitchRateCmd = this.smoothedPitchIn * spec.pitchRate * speedAuthority;
    let rollRateCmd = -this.smoothedRollIn * spec.rollRate * speedAuthority;
    let yawRateCmd = -this.smoothedYawIn * spec.yawRate * speedAuthority;

    if (!t.onGround) {
      const bankTurnRate = -Math.sin(currentRollRad) * (GRAVITY / Math.max(t.airspeedMs, 18)) * 0.92;
      const worldTurnQuat = this.tmpQuat.setFromAxisAngle(this.worldUp, bankTurnRate * dt);
      t.quaternion.premultiply(worldTurnQuat);
    } else {
      // Smooth nosewheel steering on Runways & Landable Scenic Highway!
      const groundSteer =
        (-this.smoothedYawIn - this.smoothedRollIn * 0.62) * 0.92 * clamp(t.airspeedMs / 12, 0, 1);
      const steerQuat = this.tmpQuat.setFromAxisAngle(this.worldUp, groundSteer * dt);
      t.quaternion.premultiply(steerQuat);
      rollRateCmd *= 0.08;
    }

    if (isRelaxed && !t.onGround) {
      if (Math.abs(inputs.roll) < 0.08) {
        rollRateCmd += currentRollRad * 0.62;
      } else if (Math.abs(currentRollRad) > 1.18 && Math.sign(inputs.roll) === Math.sign(currentRollRad)) {
        rollRateCmd *= 0.25;
      }
      if (Math.abs(inputs.pitch) < 0.08) {
        const targetPitch = this.options.altitudeAssist
          ? clamp(-t.velocity.y * 0.025, -0.18, 0.22)
          : 0.02;
        pitchRateCmd += (targetPitch - currentPitchRad) * 0.85;
      }
    }

    this.turbulenceClock += dt * (0.55 + cloudDensity * 0.85);
    const turbScale =
      (isRelaxed ? 0.016 : 0.052) * (1.0 + cloudDensity * 1.45) * clamp(t.airspeedMs / 40, 0, 1);
    const turbRoll = noise2D(this.turbulenceClock, 1.7) * turbScale;
    const turbPitch = noise2D(this.turbulenceClock, 9.3) * turbScale * 0.65;

    const isAirborneSlow = !t.onGround && t.airspeedMs < stallMs;
    t.stalling = this.options.stallSimulation && isAirborneSlow;
    if (t.stalling) {
      const stallDepth = clamp((stallMs - t.airspeedMs) / Math.max(stallMs * 0.35, 1), 0, 1);
      pitchRateCmd -= stallDepth * (isRelaxed ? 0.35 : 0.78);
      rollRateCmd += noise2D(this.turbulenceClock * 3.5, 4.2) * stallDepth * (isRelaxed ? 0.08 : 0.32);
    }

    const qPitch = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      (pitchRateCmd + turbPitch) * dt
    );
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRateCmd * dt);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (rollRateCmd + turbRoll) * dt
    );
    t.quaternion.multiply(qYaw).multiply(qPitch).multiply(qRoll).normalize();

    this.tmpForward.set(0, 0, -1).applyQuaternion(t.quaternion).normalize();
    this.tmpRight.set(1, 0, 0).applyQuaternion(t.quaternion).normalize();
    this.tmpUp.set(0, 1, 0).applyQuaternion(t.quaternion).normalize();

    const speed = t.velocity.length();
    if (speed > 0.1) {
      this.tmpVelDir.copy(t.velocity).divideScalar(speed);
    } else {
      this.tmpVelDir.copy(this.tmpForward);
    }

    const sinAoA = clamp(-this.tmpVelDir.dot(this.tmpUp), -0.6, 0.6);
    const aoaRad = Math.asin(sinAoA);

    const maxThrustAccel = isRelaxed ? 7.8 : 6.9;
    const speedFalloff = 1.0 - clamp(speed / (maxMs * 1.18), 0, 0.65);
    const thrustAccel = t.throttle * maxThrustAccel * speedFalloff;

    const gearDrag = t.gearDeployAnim * 0.00055;
    const brakeDrag = t.airbrakeAnim * (t.onGround ? 0.0095 : 0.0034);
    const inducedDrag = aoaRad * aoaRad * 0.0042;
    const baseDragCoeff = 0.00118 + gearDrag + brakeDrag + inducedDrag;
    const dragAccel = speed * speed * baseDragCoeff + (t.onGround && t.airbrakeActive ? 5.2 : 0);

    const effectiveAoA = aoaRad + 0.068;
    let cl = clamp(effectiveAoA * 9.5, -0.8, 1.55) * spec.liftFactor;
    if (this.options.stallSimulation && Math.abs(effectiveAoA) > 0.29) {
      cl *= isRelaxed ? 0.72 : 0.48;
    }

    let liftAccel = cl * GRAVITY * clamp(speed / (stallMs * 1.18), 0, 1.38);
    if (isRelaxed && !t.onGround && t.throttle > 0.35) {
      liftAccel = Math.max(liftAccel, GRAVITY * clamp(speed / (stallMs * 1.02), 0, 1.04) * this.tmpUp.y);
    }

    this.tmpForce.set(0, -GRAVITY, 0);
    this.tmpForce.addScaledVector(this.tmpForward, thrustAccel);
    this.tmpForce.addScaledVector(this.tmpVelDir, -dragAccel);
    this.tmpForce.addScaledVector(this.tmpUp, liftAccel);

    t.velocity.addScaledVector(this.tmpForce, dt);

    const newSpeed = t.velocity.length();
    if (newSpeed > 0.5) {
      const alignBlend = Math.min(1, dt * (isRelaxed ? 2.8 : 1.65));
      this.tmpVelDir.copy(t.velocity).divideScalar(newSpeed);
      this.tmpVelDir.lerp(this.tmpForward, alignBlend).normalize();
      t.velocity.copy(this.tmpVelDir).multiplyScalar(clamp(newSpeed, 0, maxMs * 1.2));
    }

    t.position.addScaledVector(t.velocity, dt);

    const distSq = t.position.x * t.position.x + (t.position.z + 1500) * (t.position.z + 1500);
    if (distSq > 11500 * 11500) {
      const pull = new THREE.Vector3(-t.position.x, 0, -(t.position.z + 1500)).normalize();
      t.position.addScaledVector(pull, dt * 45);
    }

    if (t.position.y > 3600) {
      t.position.y = 3600;
      if (t.velocity.y > 0) t.velocity.y *= 0.5;
    }

    // Terrain, Highway, Runway & Water Surface Contact + Haptic Vibration Detection!
    const rawGroundY = getTerrainHeight(t.position.x, t.position.z);
    const waterY = getWaterSurfaceHeight(t.position.x, t.position.z);
    const surfKind = classifySurface(t.position.x, t.position.z);
    const effectiveSurfaceY = waterY !== null ? Math.max(rawGroundY, waterY) : Math.max(0.0, rawGroundY);

    const gearClearance = t.gearDown ? 1.18 : 0.58;
    const minCenterY = effectiveSurfaceY + gearClearance;

    if (t.position.y <= minCenterY) {
      const impactVertSpeed = Math.max(0, -t.velocity.y);
      const overWater = surfKind === 'water';
      const isPaved = surfKind === 'runway' || surfKind === 'highway';
      const excessiveBank = Math.abs(THREE.MathUtils.radToDeg(currentRollRad)) > 32;
      const hardImpact = impactVertSpeed > (isRelaxed ? 13.0 : 7.0);
      const gearUpStrike = !t.gearDown && !isRelaxed;

      if (this.options.collisionDamage && (overWater || excessiveBank || hardImpact || gearUpStrike)) {
        t.crashed = true;
        t.haptics.scrapeIntensity = 1.0; // Strong crash vibration jolt!
        this.crashCooldown = 2.2;
        t.velocity.set(0, 0, 0);
        return;
      }

      t.position.y = minCenterY;

      if (overWater) {
        // Skimming water surface -> crisp splash vibration pulse + gentle bounce!
        t.surfaceType = 'water';
        if (this.scrapeCooldown <= 0) {
          t.haptics.scrapeIntensity = clamp(0.45 + impactVertSpeed * 0.1, 0.45, 1.0);
          this.scrapeCooldown = 0.28;
        }
        t.position.y = effectiveSurfaceY + 2.2;
        t.velocity.y = Math.max(2.6, Math.abs(t.velocity.y) * 0.35);
        t.onGround = false;
      } else {
        t.surfaceType = surfKind;

        // First frame wheels touch down on runway, highway, or grass -> trigger Touchdown Vibration!
        if (!this.wasOnGround) {
          const tdForce = clamp(0.28 + (impactVertSpeed / 6.0) * 0.72, 0.28, 1.0);
          t.haptics.touchdownIntensity = tdForce;
          if (!t.gearDown || excessiveBank) {
            t.haptics.scrapeIntensity = clamp(0.6 + impactVertSpeed * 0.08, 0.6, 1.0);
          }
        }

        if (t.velocity.y < 0) t.velocity.y = 0;
        t.onGround = liftAccel * this.tmpUp.y < GRAVITY * 1.02;

        // Continuous tire ground-roll vibration (silky on paved runway/highway, bumpier on off-road grass!)
        const rollNorm = clamp(t.airspeedMs / 55, 0, 1);
        t.haptics.groundRollSpeedNorm = isPaved ? rollNorm * 0.42 : rollNorm * 0.85;

        this.tmpEuler.setFromQuaternion(t.quaternion, 'YXZ');
        this.tmpEuler.z *= Math.max(0, 1 - dt * 8);
        this.tmpEuler.x = clamp(this.tmpEuler.x, -0.05, 0.24);
        t.quaternion.setFromEuler(this.tmpEuler);

        // Smooth paved rollout on both Airport Runways AND the 7.4km Scenic Highway!
        const rollFriction = isPaved
          ? t.throttle < 0.1 ? 0.55 : 0.045
          : t.throttle < 0.1 ? 1.15 : 0.24;
        t.velocity.multiplyScalar(Math.max(0, 1 - dt * rollFriction));
      }
    } else {
      t.onGround = false;
      t.surfaceType = 'air';
    }

    this.wasOnGround = t.onGround;

    t.forward.copy(this.tmpForward);
    t.up.copy(this.tmpUp);
    t.airspeedMs = t.velocity.length();
    t.airspeedKts = t.airspeedMs * KTS_PER_MS;
    t.altitudeM = t.position.y;
    t.altitudeFt = t.position.y * FT_PER_M;
    t.aglM = Math.max(0, t.position.y - effectiveSurfaceY);
    t.verticalSpeedFpm = t.velocity.y * FT_PER_M * 60;

    const flatHeadingRad = Math.atan2(this.tmpForward.x, -this.tmpForward.z);
    t.headingDeg = ((THREE.MathUtils.radToDeg(flatHeadingRad) % 360) + 360) % 360;
    t.pitchDeg = THREE.MathUtils.radToDeg(Math.asin(clamp(this.tmpForward.y, -1, 1)));
    t.rollDeg = THREE.MathUtils.radToDeg(-Math.asin(clamp(this.tmpRight.y, -1, 1)));
    t.gForce = clamp(liftAccel / GRAVITY, -0.5, 4.5);
  }

  public recoverInAir(): void {
    const safeY = Math.max(this.telemetry.position.y + 220, 480);
    this.spawn({
      position: new THREE.Vector3(this.telemetry.position.x, safeY, this.telemetry.position.z),
      headingDeg: this.telemetry.headingDeg,
      pitchDeg: 2.0,
      airspeedKts: 108,
      throttle: 0.68,
      gearDown: true,
      onGround: false,
    });
  }
}
