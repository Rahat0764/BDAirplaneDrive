import * as THREE from 'three';
import { FlightPhysics, SpawnPreset } from '../flight/FlightPhysics';
import { FlightTelemetry, GameplayModeId } from '../types';
import { AirportInfo } from '../world/TerrainSystem';

export interface ScenicWaypoint {
  name: string;
  subtitle: string;
  position: THREE.Vector3;
  radius: number;
}

export interface GameplayStatus {
  mode: GameplayModeId;
  bannerTitle: string | null;
  bannerSubtitle: string | null;
  waypointIndex: number;
  waypointTotal: number;
  waypointName: string;
  waypointDistanceM: number;
  landingSummary: string | null;
}

export const GAMEPLAY_MODE_INFO: Record<
  GameplayModeId,
  { title: string; subtitle: string }
> = {
  free_flight: {
    title: 'Free Flight',
    subtitle: 'Fly peacefully anywhere between towering cloud canyons, green valleys, mountains & ocean',
  },
  scenic_journey: {
    title: 'Scenic Journey',
    subtitle: 'Follow glowing sky ribbons through 7 breathtaking cloud, valley, lake & coastal vistas',
  },
  cloud_exploration: {
    title: 'Cloud Exploration',
    subtitle: 'Soar high among colossal cumulus cathedrals, sunlit vapor arches & misty cloud caverns',
  },
  landing_challenge: {
    title: 'Landing Approach',
    subtitle: 'Line up on scenic final approach to Dream Valley Runway 36 facing the Grand Cloud Canyon',
  },
};

export class GameplayManager {
  public readonly group = new THREE.Group();
  private mode: GameplayModeId = 'free_flight';

  private waypoints: ScenicWaypoint[] = [];
  private activeWpIndex = 0;
  private ringGroup = new THREE.Group();
  private ringMat: THREE.MeshBasicMaterial;
  private approachRingsGroup = new THREE.Group();

  private bannerTitle: string | null = null;
  private bannerSubtitle: string | null = null;
  private bannerTimer = 0;

  private landingEvaluated = false;
  private landingSummary: string | null = null;
  private prevOnGround = false;
  private lastAirborneVsFpm = 0;

  constructor(scene: THREE.Scene) {
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffe599,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    });

    const outerTorus = new THREE.Mesh(new THREE.TorusGeometry(42, 1.35, 12, 48), this.ringMat);
    const innerTorus = new THREE.Mesh(
      new THREE.TorusGeometry(34, 0.55, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })
    );
    this.ringGroup.add(outerTorus, innerTorus);
    this.ringGroup.visible = false;
    this.group.add(this.ringGroup);

    // Build gentle glide-slope guide gates for Landing Approach mode
    const gateMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.52,
    });
    for (let i = 0; i < 4; i++) {
      const gate = new THREE.Mesh(new THREE.TorusGeometry(20, 0.65, 8, 36), gateMat);
      const distFromThreshold = 340 + i * 380;
      const z = 2060 + distFromThreshold;
      const y = 28 + Math.tan(THREE.MathUtils.degToRad(3.2)) * distFromThreshold + 12;
      gate.position.set(0, y, z);
      this.approachRingsGroup.add(gate);
    }
    this.approachRingsGroup.visible = false;
    this.group.add(this.approachRingsGroup);

    this.initScenicWaypoints();
    scene.add(this.group);
  }

  private initScenicWaypoints(): void {
    this.waypoints = [
      {
        name: 'Grand Cloud Canyon',
        subtitle: 'Glide between twin towering cumulus walls beneath the luminous moon',
        position: new THREE.Vector3(0, 520, -450),
        radius: 130,
      },
      {
        name: 'Emerald Patchwork Valley',
        subtitle: 'Sunlit farmlands and winding country lanes far below',
        position: new THREE.Vector3(-90, 440, -1850),
        radius: 135,
      },
      {
        name: 'Cloud Cathedral Arch',
        subtitle: 'Skim the silver-lined crown of a giant western cloud tower',
        position: new THREE.Vector3(-390, 680, -3250),
        radius: 145,
      },
      {
        name: 'Sapphire Mirror Lake',
        subtitle: 'Descend gently over the calm alpine valley lake',
        position: new THREE.Vector3(-220, 340, -4750),
        radius: 145,
      },
      {
        name: 'Azure Island Bay',
        subtitle: 'Bank out toward the sparkling coastline and island archipelago',
        position: new THREE.Vector3(-2450, 410, -5300),
        radius: 165,
      },
      {
        name: 'High Cumulus Overlook',
        subtitle: 'Climb into crisp sky air looking back across the mountain peaks',
        position: new THREE.Vector3(-950, 640, -2400),
        radius: 160,
      },
      {
        name: 'Dream Valley Overflight',
        subtitle: 'Return gracefully above Dream Valley Airfield',
        position: new THREE.Vector3(0, 290, 1200),
        radius: 150,
      },
    ];
  }

  public getMode(): GameplayModeId {
    return this.mode;
  }

  public startMode(
    mode: GameplayModeId,
    physics: FlightPhysics,
    onChime?: () => void,
    specialSpawn: 'none' | 'runway' | 'highway' = 'none'
  ): void {
    this.mode = mode;
    this.landingEvaluated = false;
    this.landingSummary = null;
    this.prevOnGround = specialSpawn === 'runway';
    this.activeWpIndex = 0;

    this.ringGroup.visible = mode === 'scenic_journey';
    this.approachRingsGroup.visible = mode === 'landing_challenge' && specialSpawn !== 'highway';

    let spawn: SpawnPreset;

    if (specialSpawn === 'runway') {
      spawn = {
        position: new THREE.Vector3(0, 29.18, 2020),
        headingDeg: 0,
        pitchDeg: 0,
        airspeedKts: 0,
        throttle: 0.0,
        gearDown: true,
        onGround: true,
      };
      this.showBanner('Runway 36 Cleared for Takeoff', 'Advance throttle smoothly and lift off into the Cloud Canyon');
    } else if (specialSpawn === 'highway') {
      // Positioned on scenic approach aligned with the straightest valley stretch of the Landable Highway!
      spawn = {
        position: new THREE.Vector3(368, 92, 980),
        headingDeg: 356,
        pitchDeg: -2.2,
        airspeedKts: 70,
        throttle: 0.4,
        gearDown: true,
        onGround: false,
      };
      this.showBanner('Scenic Valley Highway Approach', 'Align with the yellow highway centerline below and touch down gently!');
    } else if (mode === 'scenic_journey') {
      spawn = {
        position: new THREE.Vector3(0, 545, 560),
        headingDeg: 0,
        pitchDeg: 1.2,
        airspeedKts: 112,
        throttle: 0.68,
        gearDown: false,
        onGround: false,
      };
      this.syncWaypointRing();
      this.showBanner('Scenic Journey', this.waypoints[0].subtitle);
    } else if (mode === 'cloud_exploration') {
      spawn = {
        position: new THREE.Vector3(45, 860, 420),
        headingDeg: 0,
        pitchDeg: 1.5,
        airspeedKts: 110,
        throttle: 0.7,
        gearDown: false,
        onGround: false,
      };
      this.showBanner('Cloud Exploration', 'Weave through towering cumulus cathedrals and sunlit vapor chambers');
    } else if (mode === 'landing_challenge') {
      spawn = {
        position: new THREE.Vector3(0, 205, 3850),
        headingDeg: 0, // Straight-in scenic approach to Runway 36 with giant cloud towers ahead!
        pitchDeg: -2.5,
        airspeedKts: 76,
        throttle: 0.42,
        gearDown: true,
        onGround: false,
      };
      this.showBanner('Final Approach — Runway 36', 'Keep gear down, ~65–75 kts, and flare gently over the threshold');
    } else {
      // Signature Opening & Free Flight Scene (homage to ref.mp4!)
      spawn = {
        position: new THREE.Vector3(-12, 540, 480),
        headingDeg: 356,
        pitchDeg: 1.5,
        airspeedKts: 112,
        throttle: 0.68,
        gearDown: true,
        onGround: false,
      };
      this.showBanner('Dream Flight', 'Peaceful skies ahead — fly anywhere at your own pace');
    }

    physics.spawn(spawn);
    onChime?.();
  }

  private syncWaypointRing(): void {
    const wp = this.waypoints[this.activeWpIndex];
    if (!wp) return;
    this.ringGroup.position.copy(wp.position);
    const nextWp = this.waypoints[(this.activeWpIndex + 1) % this.waypoints.length];
    this.ringGroup.lookAt(nextWp.position);
  }

  public showBanner(title: string, subtitle: string, duration = 5.2): void {
    this.bannerTitle = title;
    this.bannerSubtitle = subtitle;
    this.bannerTimer = duration;
  }

  public update(
    dt: number,
    elapsed: number,
    telemetry: FlightTelemetry,
    airport: AirportInfo,
    onWaypointReached?: () => void
  ): GameplayStatus {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.bannerTitle = null;
        this.bannerSubtitle = null;
      }
    }

    if (!telemetry.onGround) {
      this.lastAirborneVsFpm = telemetry.verticalSpeedFpm;
    }

    let wpDist = 0;
    let wpName = '';

    if (this.mode === 'scenic_journey' && this.waypoints.length > 0) {
      const wp = this.waypoints[this.activeWpIndex];
      wpName = wp.name;
      wpDist = telemetry.position.distanceTo(wp.position);

      const pulse = 1.0 + Math.sin(elapsed * 2.4) * 0.05;
      this.ringGroup.scale.setScalar(pulse);
      this.ringGroup.rotation.z += dt * 0.25;

      if (wpDist < wp.radius) {
        this.activeWpIndex = (this.activeWpIndex + 1) % this.waypoints.length;
        this.syncWaypointRing();
        const nextWp = this.waypoints[this.activeWpIndex];
        this.showBanner(nextWp.name, nextWp.subtitle, 5.5);
        onWaypointReached?.();
      }
    }

    // Show gentle touchdown feedback whenever landing smoothly on Runway OR Scenic Highway in any mode!
    if (telemetry.onGround && !this.prevOnGround) {
      const sinkFpm = Math.round(Math.abs(this.lastAirborneVsFpm));
      if (telemetry.surfaceType === 'highway') {
        const msg = sinkFpm < 240 ? 'Butter-Smooth Highway Touchdown!' : 'Landed on Scenic Valley Highway!';
        this.showBanner(msg, `Vertical rate: -${sinkFpm} fpm • Ready to roll or take off again`, 5.5);
        onWaypointReached?.();
      } else if (telemetry.surfaceType === 'runway') {
        this.landingEvaluated = true;
        const dx = Math.abs(telemetry.position.x - airport.runwayCenter.x);
        const rating =
          sinkFpm < 170 && dx < 6
            ? 'Butter-Smooth Greased Landing!'
            : sinkFpm < 350
            ? 'Smooth Runway Touchdown!'
            : 'Safe Runway Arrival';
        this.landingSummary = `${rating} (-${sinkFpm} fpm)`;
        this.showBanner(rating, `Touchdown rate: -${sinkFpm} fpm`, 6.0);
        onWaypointReached?.();
      }
    }

    if (this.mode === 'landing_challenge') {
      wpName = 'Runway 36 Threshold';
      wpDist = telemetry.position.distanceTo(airport.thresholdSouth);
    }

    this.prevOnGround = telemetry.onGround;

    return {
      mode: this.mode,
      bannerTitle: this.bannerTitle,
      bannerSubtitle: this.bannerSubtitle,
      waypointIndex: this.activeWpIndex + 1,
      waypointTotal: this.waypoints.length,
      waypointName: wpName,
      waypointDistanceM: Math.round(wpDist),
      landingSummary: this.landingSummary,
    };
  }
}
