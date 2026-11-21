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
    flightMode: 'simulation',
    altitudeAssist: false,
    collisionDamage: true,
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
  // v3 realism state
  private angVelPitch = 0;
  private angVelRoll = 0;
  private angVelYaw = 0;
  private gearCompression = 0;
  private crashSliding = false;

  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpVelDir = new THREE.Vector3();
  private readonly tmpForce = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpQuat2 = new THREE.Quaternion();
  private readonly tmpQuat3 = new THREE.Quaternion();
  private readonly tmpVec = new THREE.Vector3();
  private readonly axisX = new THREE.Vector3(1, 0, 0);
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly axisZ = new THREE.Vector3(0, 0, 1);
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
      waterSkimIntensity: 0,
      gForce: 1.0,
      aileronInput: 0,
      elevatorInput: 0,
      rudderInput: 0,
      gearCompression: 0,
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
    t.waterSkimIntensity = 0;
    t.gForce = 1.0;
    t.haptics.touchdownIntensity = 0;
    t.haptics.scrapeIntensity = 0;
    t.haptics.groundRollSpeedNorm = 0;

    this.wasOnGround = preset.onGround;
    this.smoothedPitchIn = 0;
    this.smoothedRollIn = 0;
    this.smoothedYawIn = 0;
    this.angVelPitch = 0; this.angVelRoll = 0; this.angVelYaw = 0;
    this.gearCompression = preset.onGround ? 0.08 : 0;
    t.gearCompression = this.gearCompression;
    this.crashSliding = false;
    this.crashCooldown = 0;
  }

  public update(
    rawDt: number,
    inputs: ControlInputs,
    getTerrainHeight: (x: number, z: number) => number,
    getWaterSurfaceHeight: (x: number, z: number) => number | null,
    classifySurface: (x: number, z: number) => 'runway' | 'highway' | 'water' | 'terrain',
    cloudDensity: number,
    weatherTurbulence = 0
  ): void {
    const dt = Math.min(rawDt, 0.05);
    const t = this.telemetry;
    const spec = AIRCRAFT_SPECS[this.variant];
    const isRelaxed = this.options.flightMode === 'relaxed';

    t.haptics.touchdownIntensity = 0;
    t.haptics.scrapeIntensity = 0;
    t.haptics.groundRollSpeedNorm = 0;
    t.waterSkimIntensity = 0;
    if (this.scrapeCooldown > 0) this.scrapeCooldown -= dt;

    t.cloudDensity = cloudDensity;

    if (t.crashed) {
      this.crashCooldown -= dt;
      // v3: slide to rest with friction over ~1-2s instead of instant freeze
      if (this.crashSliding) {
        const surfY = getTerrainHeight(t.position.x, t.position.z);
        const wY = getWaterSurfaceHeight(t.position.x, t.position.z);
        const effY = wY !== null ? Math.max(surfY, wY) : Math.max(0, surfY);
        const fric = 2.2;
        t.velocity.multiplyScalar(Math.max(0, 1 - fric * dt));
        if (t.velocity.y < 0) t.velocity.y = 0;
        t.position.addScaledVector(t.velocity, dt);
        const minY = effY + (t.gearDown ? 1.18 : 0.62) - Math.min(this.gearCompression, 0.25);
        if (t.position.y < minY) t.position.y = minY;
        t.airspeedMs = t.velocity.length(); t.airspeedKts = t.airspeedMs * KTS_PER_MS;
        if (t.velocity.lengthSq() < 0.25) { t.velocity.set(0,0,0); this.crashSliding = false; }
      }
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

    // v3 actuator lag + rate limit: surfaces lag the stick (~120-180ms sim, faster relaxed)
    const lagRate = isRelaxed ? 9.0 : 5.5;
    const maxRate = isRelaxed ? 5.0 : 3.4; // deflection units / sec
    const actuate = (cur: number, target: number) => {
      let step = (target - cur) * Math.min(1, dt * lagRate);
      const lim = maxRate * dt;
      step = clamp(step, -lim, lim);
      return cur + step;
    };
    this.smoothedPitchIn = actuate(this.smoothedPitchIn, inputs.pitch);
    this.smoothedRollIn = actuate(this.smoothedRollIn, inputs.roll);
    this.smoothedYawIn = actuate(this.smoothedYawIn, inputs.yaw);

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
    const maxMs = spec.maxSpeedKts * MS_PER_KTS;
    const speedAuthority = clamp(t.airspeedMs / (stallMs * 1.15), 0.24, 1.25);

    // prop wash: at low speed / high throttle the prop blast restores some authority
    const propWash = t.throttle * clamp(1 - t.airspeedMs / Math.max(stallMs * 1.25, 1), 0, 1) * 0.38;
    const authority = clamp(speedAuthority + propWash, 0.24, 1.35);
    let pitchRateCmd = this.smoothedPitchIn * spec.pitchRate * authority;
    let rollRateCmd = -this.smoothedRollIn * spec.rollRate * authority;
    let yawRateCmd = -this.smoothedYawIn * spec.yawRate * authority;
    if (!isRelaxed && !t.onGround) {
      yawRateCmd += this.smoothedRollIn * 0.16 * authority; // adverse yaw
      rollRateCmd += t.throttle * 0.018; // prop torque
    }

    if (!t.onGround) {
      const bankTurnRate = -Math.sin(currentRollRad) * (GRAVITY / Math.max(t.airspeedMs, 18)) * 0.92;
      const worldTurnQuat = this.tmpQuat.setFromAxisAngle(this.worldUp, bankTurnRate * dt);
      t.quaternion.premultiply(worldTurnQuat);
    } else {
      const steerFade = clamp(t.airspeedMs / 10, 0, 1) * clamp(1.18 - t.airspeedMs / 55, 0.32, 1);
      const groundSteer =
        (-this.smoothedYawIn - this.smoothedRollIn * 0.65) * 0.96 * steerFade;
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

    this.turbulenceClock += dt * (0.55 + cloudDensity * 0.85 + weatherTurbulence * 0.7);
    const turbScale =
      (isRelaxed ? 0.016 : 0.052) *
      (1.0 + cloudDensity * 1.4 + weatherTurbulence * 1.65) *
      clamp(t.airspeedMs / 40, 0, 1);
    const turbRoll = noise2D(this.turbulenceClock, 1.7) * turbScale;
    const turbPitch = noise2D(this.turbulenceClock, 9.3) * turbScale * 0.65;

    const isAirborneSlow = !t.onGround && t.airspeedMs < stallMs;
    t.stalling = this.options.stallSimulation && isAirborneSlow;
    if (t.stalling) {
      const stallDepth = clamp((stallMs - t.airspeedMs) / Math.max(stallMs * 0.35, 1), 0, 1);
      pitchRateCmd -= stallDepth * (isRelaxed ? 0.35 : 0.78);
      rollRateCmd += noise2D(this.turbulenceClock * 3.5, 4.2) * stallDepth * (isRelaxed ? 0.08 : 0.32);
    }

    // v3 angular inertia/damping: angular velocity eases toward commanded rate
    const angBlend = Math.min(1, dt * (isRelaxed ? 10 : 6.0));
    this.angVelPitch += (pitchRateCmd - this.angVelPitch) * angBlend;
    this.angVelRoll += (rollRateCmd - this.angVelRoll) * angBlend;
    this.angVelYaw += (yawRateCmd - this.angVelYaw) * angBlend;
    const qPitch = this.tmpQuat.setFromAxisAngle(this.axisX, (this.angVelPitch + turbPitch) * dt);
    // reuse separate temps (tmpQuat is overwritten above, so use dedicated quats in sequence)
    t.quaternion.multiply(qPitch);
    const qYaw = this.tmpQuat2.setFromAxisAngle(this.axisY, this.angVelYaw * dt);
    t.quaternion.multiply(qYaw);
    const qRoll = this.tmpQuat3.setFromAxisAngle(this.axisZ, (this.angVelRoll + turbRoll) * dt);
    t.quaternion.multiply(qRoll).normalize();

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

    const maxThrustAccel = isRelaxed ? 8.0 : 7.0;
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

    // v3 ground effect: extra lift / less induced drag within ~one wingspan of surface
    const preGroundY = getTerrainHeight(t.position.x, t.position.z);
    const preWaterY = getWaterSurfaceHeight(t.position.x, t.position.z);
    const preSurfY = preWaterY !== null ? Math.max(preGroundY, preWaterY) : Math.max(0, preGroundY);
    const hAboveSurf = t.position.y - preSurfY;
    const geFactor = !t.onGround && hAboveSurf > 0 && hAboveSurf < spec.wingSpan
      ? 1 + 0.20 * (1 - hAboveSurf / spec.wingSpan) : 1;
    let liftAccel = cl * GRAVITY * clamp(speed / (stallMs * 1.18), 0, 1.38) * geFactor;
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

    // Wide open world boundary (includes expanded open sea!)
    const distSq = t.position.x * t.position.x + (t.position.z + 1500) * (t.position.z + 1500);
    if (distSq > 13500 * 13500) {
      const pull = this.tmpVec.set(-t.position.x, 0, -(t.position.z + 1500)).normalize();
      t.position.addScaledVector(pull, dt * 45);
    }

    if (t.position.y > 3600) {
      t.position.y = 3600;
      if (t.velocity.y > 0) t.velocity.y *= 0.5;
    }

    // Terrain, Highway, Runway & Dynamic Wave Water Physics!
    const rawGroundY = getTerrainHeight(t.position.x, t.position.z);
    const waterY = getWaterSurfaceHeight(t.position.x, t.position.z);
    const surfKind = classifySurface(t.position.x, t.position.z);
    const effectiveSurfaceY = waterY !== null ? Math.max(rawGroundY, waterY) : Math.max(0.0, rawGroundY);

    // Low-altitude ground-effect water spray when skimming just above the sea!
    if (surfKind === 'water' && waterY !== null) {
      const heightAboveWave = t.position.y - waterY;
      if (heightAboveWave < 5.5 && t.airspeedMs > 14) {
        t.waterSkimIntensity = clamp((5.5 - heightAboveWave) / 4.2, 0, 0.55) * clamp(t.airspeedMs / 45, 0, 1);
      }
    }

    const gearClearance = t.gearDown ? 1.18 : 0.62;
    const minCenterY = effectiveSurfaceY + gearClearance;

    if (t.position.y <= minCenterY) {
      const impactVertSpeed = Math.max(0, -t.velocity.y);
      const overWater = surfKind === 'water';
      const isPaved = surfKind === 'runway' || surfKind === 'highway';
      const excessiveBank = Math.abs(THREE.MathUtils.radToDeg(currentRollRad)) > 34;
      const hardImpact = impactVertSpeed > (isRelaxed ? 13.0 : 7.5);
      const gearUpStrike = !t.gearDown && !isRelaxed && !overWater;

      const bellyScrape = gearUpStrike && !hardImpact && !excessiveBank && !overWater;
      if (this.options.collisionDamage && (excessiveBank || hardImpact || (gearUpStrike && !bellyScrape))) {
        t.crashed = true;
        t.haptics.scrapeIntensity = 1.0;
        this.crashCooldown = 2.6;
        // v3: keep momentum and slide to rest
        t.velocity.y = 0;
        t.velocity.multiplyScalar(0.55);
        this.crashSliding = true;
        this.gearCompression = 0.25;
        return;
      }
      if (bellyScrape) {
        t.haptics.scrapeIntensity = clamp(0.6 + impactVertSpeed * 0.08, 0.6, 1.0);
        t.velocity.multiplyScalar(Math.max(0, 1 - dt * 3.2)); // rapid scrape decel
      }

      if (overWater) {
        // REALISTIC HYDROPLANING, BUOYANCY & WAVE BOBBING PHYSICS!
        t.surfaceType = 'water';
        const submergeDepth = minCenterY - t.position.y;
        const speedNorm = clamp(t.airspeedMs / 48, 0, 1);

        // Buoyancy + hydrodynamic planing lift pushes smoothly along wave surface
        const buoyancyAccel = submergeDepth * 26.0 + speedNorm * 4.2;
        t.velocity.y += (buoyancyAccel - t.velocity.y * 3.8) * dt;
        t.position.y = Math.max(effectiveSurfaceY + 0.48, t.position.y);

        // v3 slow-speed draft: below ~8 m/s the hull sinks a bit and drag rises
        if (t.airspeedMs < 8) {
          t.position.y = Math.max(effectiveSurfaceY + 0.30, t.position.y - dt * 0.35);
        }
        // Realistic water drag slows aircraft gently while skimming
        const waterDrag = 0.42 + (t.airbrakeActive ? 0.95 : 0.0) + (t.gearDown ? 0.25 : 0.0) + (t.airspeedMs < 8 ? 0.85 : 0);
        t.velocity.x *= Math.max(0, 1 - waterDrag * dt);
        t.velocity.z *= Math.max(0, 1 - waterDrag * dt);

        // Gentle wave-bobbing pitch & roll stabilization on water
        this.tmpEuler.setFromQuaternion(t.quaternion, 'YXZ');
        const waveBob = Math.sin(this.turbulenceClock * 3.2) * 0.04;
        this.tmpEuler.z *= Math.max(0, 1 - dt * 5.0);
        this.tmpEuler.x = THREE.MathUtils.lerp(this.tmpEuler.x, 0.055 + waveBob, Math.min(1, dt * 4.5));
        t.quaternion.setFromEuler(this.tmpEuler);

        t.waterSkimIntensity = clamp(0.45 + speedNorm * 0.55 + submergeDepth * 0.3, 0.35, 1.0);
        t.onGround = speedNorm < 0.72;
        t.haptics.groundRollSpeedNorm = speedNorm * 0.58;

        if (!this.wasOnGround || (impactVertSpeed > 2.5 && this.scrapeCooldown <= 0)) {
          t.haptics.scrapeIntensity = clamp(0.38 + impactVertSpeed * 0.09, 0.38, 0.95);
          this.scrapeCooldown = 0.26;
        }
      } else {
        t.position.y = minCenterY;
        t.surfaceType = surfKind;

        if (!this.wasOnGround) {
          const tdForce = clamp(0.28 + (impactVertSpeed / 6.0) * 0.72, 0.28, 1.0);
          t.haptics.touchdownIntensity = tdForce;
          if (!t.gearDown || excessiveBank) {
            t.haptics.scrapeIntensity = clamp(0.6 + impactVertSpeed * 0.08, 0.6, 1.0);
          }
        }

        if (t.velocity.y < 0) t.velocity.y = 0;
        t.onGround = liftAccel * this.tmpUp.y < GRAVITY * 1.02;

        const rollNorm = clamp(t.airspeedMs / 55, 0, 1);
        t.haptics.groundRollSpeedNorm = isPaved ? rollNorm * 0.42 : rollNorm * 0.85;

        this.tmpEuler.setFromQuaternion(t.quaternion, 'YXZ');
        this.tmpEuler.z *= Math.max(0, 1 - dt * 8);
        this.tmpEuler.x = clamp(this.tmpEuler.x, -0.05, 0.24);
        t.quaternion.setFromEuler(this.tmpEuler);

        const braking = t.airbrakeActive || t.throttle < 0.1;
        const rollFriction = surfKind === 'runway'
          ? braking ? 0.55 : 0.045
          : surfKind === 'highway'
          ? braking ? 0.72 : 0.08
          : braking ? 1.15 : 0.24;
        t.velocity.multiplyScalar(Math.max(0, 1 - dt * rollFriction));
        // v3 suspension: rest compression on ground, bounce on touchdown
        if (!this.wasOnGround && impactVertSpeed > 0.5) {
          this.gearCompression = clamp(0.08 + impactVertSpeed * 0.028, 0.08, 0.25);
          if (impactVertSpeed < 6) t.velocity.y = clamp(impactVertSpeed * 0.10, 0, 0.9);
        }
      }
    } else {
      t.onGround = false;
      t.surfaceType = 'air';
    }

    // v3 suspension decay toward resting compression / zero in air
    const targetComp = t.onGround ? 0.08 : 0;
    this.gearCompression += (targetComp - this.gearCompression) * Math.min(1, dt * 7);
    t.gearCompression = clamp(this.gearCompression, 0, 0.25);

    // v3 HARD ground-penetration clamp (landing sink bug fix) for all surfaces
    {
      const gc = t.gearDown ? 1.18 : 0.62;
      const isWaterSurf = surfKind === 'water' && waterY !== null;
      const minDraft = isWaterSurf ? 0.30 : 0;
      const hardMinY = isWaterSurf
        ? effectiveSurfaceY + minDraft
        : effectiveSurfaceY + gc - Math.min(this.gearCompression, 0.25);
      if (t.position.y < hardMinY) {
        t.position.y = hardMinY;
        if (t.velocity.y < 0) t.velocity.y = this.gearCompression > 0.12 ? Math.min(0.6, -t.velocity.y * 0.08) : 0;
      }
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
