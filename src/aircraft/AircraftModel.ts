import * as THREE from 'three';
import { AircraftSpec, AircraftVariantId, FlightTelemetry } from '../types';
import { clamp } from '../utils/noise';

export const AIRCRAFT_SPECS: Record<AircraftVariantId, AircraftSpec> = {
  cloudrunner: {
    id: 'cloudrunner',
    name: 'Cloudrunner SR-1',
    subtitle: 'Sleek Low-Wing Scenic Cruiser',
    description:
      'Classic touring monoplane with pearl-white clearcoat, crimson wing accents, panoramic bubble canopy, and crisp balanced handling.',
    cruiseSpeedKts: 118,
    maxSpeedKts: 168,
    stallSpeedKts: 46,
    rollRate: 1.58,
    pitchRate: 1.14,
    yawRate: 0.74,
    liftFactor: 1.0,
    wingSpan: 11.2,
    accentColor: '#d63638',
  },
  skyhawk: {
    id: 'skyhawk',
    name: 'Skyhawk Valley 180',
    subtitle: 'High-Wing Bush & Sea Explorer',
    description:
      'Strut-braced high-wing explorer with sapphire trim, high low-speed lift, and effortless short-field & coastal water skimming.',
    cruiseSpeedKts: 106,
    maxSpeedKts: 148,
    stallSpeedKts: 40,
    rollRate: 1.28,
    pitchRate: 1.08,
    yawRate: 0.8,
    liftFactor: 1.15,
    wingSpan: 11.6,
    accentColor: '#1d6fd6',
  },
  albatross: {
    id: 'albatross',
    name: 'Albatross Glide-X',
    subtitle: 'Long-Span Cloud Soarer',
    description:
      'Graceful high-aspect-ratio touring motor-glider with pearl-silver finish and emerald wingtips built for soaring beside giant cumulus towers.',
    cruiseSpeedKts: 98,
    maxSpeedKts: 142,
    stallSpeedKts: 36,
    rollRate: 1.12,
    pitchRate: 1.0,
    yawRate: 0.7,
    liftFactor: 1.3,
    wingSpan: 14.4,
    accentColor: '#179973',
  },
};

export const AIRCRAFT_ORDER: AircraftVariantId[] = ['cloudrunner', 'skyhawk', 'albatross'];

interface SprayParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

export class AircraftModel {
  public readonly root = new THREE.Group();
  public readonly cockpitAnchor = new THREE.Object3D();

  private modelGroup = new THREE.Group();
  private propHub = new THREE.Group();
  private propBlurDisc!: THREE.Mesh;
  private propBlurMat!: THREE.MeshBasicMaterial;
  private pilotScarf!: THREE.Mesh;

  private leftAileronPivot = new THREE.Group();
  private rightAileronPivot = new THREE.Group();
  private elevatorPivot = new THREE.Group();
  private rudderPivot = new THREE.Group();
  private leftAirbrakePivot = new THREE.Group();
  private rightAirbrakePivot = new THREE.Group();

  private noseGearPivot = new THREE.Group();
  private leftGearPivot = new THREE.Group();
  private rightGearPivot = new THREE.Group();

  private strobeMesh!: THREE.Mesh;
  private strobeMat!: THREE.MeshBasicMaterial;
  private landingSpot!: THREE.SpotLight;

  // Wingtip vapor ribbon trails
  private trailLength = 34;
  private leftTrailPoints: THREE.Vector3[] = [];
  private rightTrailPoints: THREE.Vector3[] = [];
  private leftTrailLine!: THREE.Line;
  private rightTrailLine!: THREE.Line;
  private leftTrailGeo!: THREE.BufferGeometry;
  private rightTrailGeo!: THREE.BufferGeometry;
  private trailMat!: THREE.LineBasicMaterial;
  private leftTipWorld = new THREE.Vector3();
  private rightTipWorld = new THREE.Vector3();
  private leftTipLocal = new THREE.Vector3(-5.6, 0.1, 0.2);
  private rightTipLocal = new THREE.Vector3(5.6, 0.1, 0.2);

  // 3D Hydroplane Water Spray & Wake Particles
  private sprayMesh!: THREE.InstancedMesh;
  private sprayParticles: SprayParticle[] = [];
  private sprayCursor = 0;
  private readonly sprayDummy = new THREE.Object3D();
  private readonly tmpBackVec = new THREE.Vector3();
  private readonly tmpSideVec = new THREE.Vector3();

  private panelBumpTex: THREE.CanvasTexture;
  private currentVariant: AircraftVariantId = 'cloudrunner';

  constructor(scene: THREE.Scene) {
    this.panelBumpTex = this.createAirframePanelTexture();
    this.root.add(this.modelGroup);
    this.root.add(this.cockpitAnchor);
    scene.add(this.root);

    this.initTrails(scene);
    this.initWaterSpray(scene);
    this.buildVariant('cloudrunner');
  }

  /**
   * Procedurally bakes subtle metallic aviation panel lines & rivets for crisp close-up realism!
   */
  private createAirframePanelTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = '#5c5c5c';
    ctx.lineWidth = 2;
    for (let x = 0; x <= 512; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
    }
    for (let y = 0; y <= 512; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }

    // Subtle rivet rows along seams
    ctx.fillStyle = '#a0a0a0';
    for (let x = 8; x < 512; x += 64) {
      for (let y = 8; y < 512; y += 16) {
        ctx.fillRect(x, y, 2, 2);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    return tex;
  }

  private createPropBlurTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const cx = 128;
    const cy = 128;

    const radial = ctx.createRadialGradient(cx, cy, 14, cx, cy, 122);
    radial.addColorStop(0.0, 'rgba(40,45,52,0.0)');
    radial.addColorStop(0.18, 'rgba(55,60,68,0.34)');
    radial.addColorStop(0.75, 'rgba(70,76,86,0.22)');
    radial.addColorStop(0.92, 'rgba(235,240,248,0.28)');
    radial.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = radial;
    ctx.beginPath();
    ctx.arc(cx, cy, 124, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  private createAirfoilExtrude(chord: number, thickness: number, span: number, taper = 0.72): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = (0.32 - t) * chord;
      const yt =
        5 *
        thickness *
        (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1015 * t * t * t * t);
      const camber = 0.03 * chord * (4 * t * (1 - t));
      if (i === 0) shape.moveTo(x, yt + camber);
      else shape.lineTo(x, yt + camber);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const x = (0.32 - t) * chord;
      const yt =
        5 *
        thickness *
        (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t * t * t - 0.1015 * t * t * t * t);
      const camber = 0.03 * chord * (4 * t * (1 - t));
      shape.lineTo(x, -yt * 0.68 + camber);
    }

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: span,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 8,
      bevelSize: 0.025,
      bevelThickness: 0.03,
    });

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const sFrac = clamp(pz / Math.max(span, 0.01), 0, 1);
      const scale = THREE.MathUtils.lerp(1.0, taper, sFrac);
      const sweep = -sFrac * chord * 0.18;
      pos.setXYZ(i, pz, py * scale, -px * scale - sweep);
    }
    geo.computeVertexNormals();
    return geo;
  }

  public buildVariant(variant: AircraftVariantId): void {
    this.currentVariant = variant;
    const spec = AIRCRAFT_SPECS[variant];

    while (this.modelGroup.children.length > 0) {
      this.modelGroup.remove(this.modelGroup.children[0]);
    }
    this.propHub = new THREE.Group();
    this.leftAileronPivot = new THREE.Group();
    this.rightAileronPivot = new THREE.Group();
    this.elevatorPivot = new THREE.Group();
    this.rudderPivot = new THREE.Group();
    this.leftAirbrakePivot = new THREE.Group();
    this.rightAirbrakePivot = new THREE.Group();
    this.noseGearPivot = new THREE.Group();
    this.leftGearPivot = new THREE.Group();
    this.rightGearPivot = new THREE.Group();

    const bodyPaintMat = new THREE.MeshPhysicalMaterial({
      color: variant === 'albatross' ? 0xf2f6fa : 0xfbfdff,
      roughness: 0.18,
      metalness: variant === 'albatross' ? 0.24 : 0.1,
      clearcoat: 0.94,
      clearcoatRoughness: 0.1,
      bumpMap: this.panelBumpTex,
      bumpScale: 0.014,
    });

    const accentMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(spec.accentColor),
      roughness: 0.22,
      metalness: 0.16,
      clearcoat: 0.88,
    });

    const darkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x1d242e,
      roughness: 0.42,
      metalness: 0.58,
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e9f2,
      roughness: 0.12,
      metalness: 0.94,
    });

    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x181a1e,
      roughness: 0.88,
      metalness: 0.05,
    });

    const glassCanopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x99c4e0,
      roughness: 0.05,
      metalness: 0.06,
      transparent: true,
      opacity: 0.38,
      reflectivity: 0.96,
      clearcoat: 1.0,
      side: THREE.DoubleSide,
    });

    // 1. Sleek Aerodynamic Lathe Fuselage
    const fuseProfile: THREE.Vector2[] = [
      new THREE.Vector2(0.01, -3.78),
      new THREE.Vector2(0.32, -3.38),
      new THREE.Vector2(0.57, -2.55),
      new THREE.Vector2(0.67, -1.35),
      new THREE.Vector2(0.69, -0.15),
      new THREE.Vector2(0.58, 1.05),
      new THREE.Vector2(0.38, 2.35),
      new THREE.Vector2(0.2, 3.65),
      new THREE.Vector2(0.04, 4.08),
    ];
    const fuseGeo = new THREE.LatheGeometry(fuseProfile, 32);
    fuseGeo.rotateX(Math.PI / 2);
    fuseGeo.scale(0.95, 1.04, 1.0);
    fuseGeo.computeVertexNormals();

    const fuselage = new THREE.Mesh(fuseGeo, bodyPaintMat);
    fuselage.castShadow = true;
    fuselage.receiveShadow = true;
    this.modelGroup.add(fuselage);

    // Sculpted side livery chevron stripe + gold pinstripe
    const stripeGeo = new THREE.BoxGeometry(1.33, 0.13, 5.5);
    const stripeMesh = new THREE.Mesh(stripeGeo, accentMat);
    stripeMesh.position.set(0, 0.02, 0.32);
    this.modelGroup.add(stripeMesh);

    const pinStripe = new THREE.Mesh(
      new THREE.BoxGeometry(1.34, 0.032, 5.2),
      new THREE.MeshStandardMaterial({ color: 0xf4c96b, roughness: 0.25, metalness: 0.6 })
    );
    pinStripe.position.set(0, 0.11, 0.35);
    this.modelGroup.add(pinStripe);

    // Cowling air intake + twin chrome exhaust pipes + dorsal antenna
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.18, 0.45), darkTrimMat);
    intake.position.set(0, -0.18, -3.16);
    this.modelGroup.add(intake);

    const exhaustGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.55, 8);
    exhaustGeo.rotateX(Math.PI / 2.2);
    for (const sx of [-0.34, 0.34]) {
      const ex = new THREE.Mesh(exhaustGeo, chromeMat);
      ex.position.set(sx, -0.42, -2.55);
      this.modelGroup.add(ex);
    }

    const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.46, 0.12), darkTrimMat);
    antenna.position.set(0, 0.64, 1.55);
    antenna.rotation.x = -0.35;
    this.modelGroup.add(antenna);

    // 2. Detailed Cockpit Interior + Avionics + Ghibli Pilot with Fluttering Scarf!
    const isHighWing = variant === 'skyhawk';
    const cockpitGroup = new THREE.Group();
    const tub = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.45, 1.78), darkTrimMat);
    tub.position.set(0, 0.25, -0.35);
    cockpitGroup.add(tub);

    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.38, 0.3), darkTrimMat);
    dash.position.set(0, 0.56, -1.12);
    cockpitGroup.add(dash);

    const pfdScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    pfdScreen.position.set(-0.17, 0.59, -0.96);
    cockpitGroup.add(pfdScreen);

    const mfdScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x34d399 })
    );
    mfdScreen.position.set(0.19, 0.59, -0.96);
    cockpitGroup.add(mfdScreen);

    // Pilot seat, shoulders, aviator helmet, goggles & scarf
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.14), darkTrimMat);
    seatBack.position.set(0, 0.58, 0.08);
    cockpitGroup.add(seatBack);

    const pilotJacket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.24, 0.36, 12),
      new THREE.MeshStandardMaterial({ color: 0x4b382a, roughness: 0.78 })
    );
    pilotJacket.position.set(0, 0.54, -0.18);
    cockpitGroup.add(pilotJacket);

    const pilotHead = new THREE.Mesh(
      new THREE.SphereGeometry(0.145, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0x2f251e, roughness: 0.6 })
    );
    pilotHead.position.set(0, 0.81, -0.18);
    cockpitGroup.add(pilotHead);

    const goggles = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.06, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.12, metalness: 0.8 })
    );
    goggles.position.set(0, 0.83, -0.29);
    cockpitGroup.add(goggles);

    this.pilotScarf = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.035, 0.32),
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.65 })
    );
    this.pilotScarf.position.set(0.08, 0.71, -0.02);
    cockpitGroup.add(this.pilotScarf);

    this.modelGroup.add(cockpitGroup);

    // Panoramic Tinted Bubble Canopy + Twin Frame Arches
    const canopyGeo = new THREE.SphereGeometry(0.62, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.52);
    canopyGeo.scale(0.92, 0.85, 1.98);
    const canopy = new THREE.Mesh(canopyGeo, glassCanopyMat);
    canopy.position.set(0, 0.44, -0.38);
    this.modelGroup.add(canopy);

    const canopyArch = new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.025, 8, 24, Math.PI),
      bodyPaintMat
    );
    canopyArch.position.set(0, 0.44, -0.45);
    this.modelGroup.add(canopyArch);

    const frontArch = new THREE.Mesh(
      new THREE.TorusGeometry(0.51, 0.022, 8, 20, Math.PI),
      darkTrimMat
    );
    frontArch.position.set(0, 0.46, -1.02);
    frontArch.rotation.x = -0.35;
    this.modelGroup.add(frontArch);

    this.cockpitAnchor.position.set(0, 0.83, -0.42);

    // 3. Main Wings + Accent Wingtips + Winglets + Pitot Tube
    const halfSpan = spec.wingSpan * 0.5;
    const wingY = isHighWing ? 0.88 : -0.22;
    const dihedral = isHighWing ? 0.02 : 0.068;
    const chord = variant === 'albatross' ? 1.32 : 1.58;

    const rightWingGeo = this.createAirfoilExtrude(
      chord,
      0.13,
      halfSpan - 0.42,
      variant === 'albatross' ? 0.55 : 0.68
    );
    const rightWing = new THREE.Mesh(rightWingGeo, bodyPaintMat);
    rightWing.castShadow = true;
    rightWing.receiveShadow = true;

    const leftWing = rightWing.clone();
    leftWing.scale.x = -1;

    const rightWingHolder = new THREE.Group();
    rightWingHolder.position.set(0.42, wingY, -0.45);
    rightWingHolder.rotation.z = dihedral;
    rightWingHolder.add(rightWing);

    const leftWingHolder = new THREE.Group();
    leftWingHolder.position.set(-0.42, wingY, -0.45);
    leftWingHolder.rotation.z = -dihedral;
    leftWingHolder.add(leftWing);

    // Wingtip accent roundels + outer tip bands
    const tipDecalGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.035, 24);
    const rightDecal = new THREE.Mesh(tipDecalGeo, accentMat);
    rightDecal.position.set(halfSpan - 1.45, 0.08, 0.35);
    rightWingHolder.add(rightDecal);

    const leftDecal = rightDecal.clone();
    leftDecal.position.x = -(halfSpan - 1.45);
    leftWingHolder.add(leftDecal);

    const wingletGeo = new THREE.BoxGeometry(0.065, 0.56, 0.56);
    const rWinglet = new THREE.Mesh(wingletGeo, accentMat);
    rWinglet.position.set(halfSpan - 0.42, 0.24, 0.42);
    rWinglet.rotation.z = -0.24;
    rightWingHolder.add(rWinglet);

    const lWinglet = new THREE.Mesh(wingletGeo, accentMat);
    lWinglet.position.set(-(halfSpan - 0.42), 0.24, 0.42);
    lWinglet.rotation.z = 0.24;
    leftWingHolder.add(lWinglet);

    // Under-wing pitot tube
    const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 6), chromeMat);
    pitot.rotation.x = Math.PI / 2;
    pitot.position.set(-2.2, -0.14, -0.15);
    leftWingHolder.add(pitot);

    if (isHighWing) {
      const strutGeo = new THREE.CylinderGeometry(0.032, 0.032, 2.55, 8);
      const rStrut = new THREE.Mesh(strutGeo, bodyPaintMat);
      rStrut.position.set(1.55, 0.26, -0.35);
      rStrut.rotation.z = -1.08;
      this.modelGroup.add(rStrut);

      const lStrut = rStrut.clone();
      lStrut.position.x = -1.55;
      lStrut.rotation.z = 1.08;
      this.modelGroup.add(lStrut);
    }

    const ailSpan = halfSpan * 0.36;
    const ailGeo = new THREE.BoxGeometry(ailSpan, 0.055, 0.32);
    ailGeo.translate(0, 0, 0.16);

    this.rightAileronPivot.position.set(halfSpan * 0.62, -0.01, chord * 0.62);
    this.rightAileronPivot.add(new THREE.Mesh(ailGeo, accentMat));
    rightWingHolder.add(this.rightAileronPivot);

    this.leftAileronPivot.position.set(-halfSpan * 0.62, -0.01, chord * 0.62);
    this.leftAileronPivot.add(new THREE.Mesh(ailGeo, accentMat));
    leftWingHolder.add(this.leftAileronPivot);

    const spoilerGeo = new THREE.BoxGeometry(halfSpan * 0.28, 0.032, 0.22);
    spoilerGeo.translate(0, 0, 0.11);
    this.rightAirbrakePivot.position.set(halfSpan * 0.28, 0.09, chord * 0.28);
    this.rightAirbrakePivot.add(new THREE.Mesh(spoilerGeo, darkTrimMat));
    rightWingHolder.add(this.rightAirbrakePivot);

    this.leftAirbrakePivot.position.set(-halfSpan * 0.28, 0.09, chord * 0.28);
    this.leftAirbrakePivot.add(new THREE.Mesh(spoilerGeo, darkTrimMat));
    leftWingHolder.add(this.leftAirbrakePivot);

    const navGeo = new THREE.SphereGeometry(0.08, 10, 10);
    const portNav = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: 0xff2e2e }));
    portNav.position.set(-(halfSpan - 0.4), 0.04, 0.22);
    leftWingHolder.add(portNav);

    const stbdNav = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: 0x22ff66 }));
    stbdNav.position.set(halfSpan - 0.4, 0.04, 0.22);
    rightWingHolder.add(stbdNav);

    this.modelGroup.add(rightWingHolder);
    this.modelGroup.add(leftWingHolder);

    this.leftTipLocal.set(-halfSpan, wingY + Math.sin(dihedral) * halfSpan, -0.1);
    this.rightTipLocal.set(halfSpan, wingY + Math.sin(dihedral) * halfSpan, -0.1);

    // 4. Tail Empennage
    const hStabSpan = 1.88;
    const rStabGeo = this.createAirfoilExtrude(0.92, 0.1, hStabSpan, 0.62);
    const rStab = new THREE.Mesh(rStabGeo, bodyPaintMat);
    rStab.position.set(0.12, 0.22, 3.35);
    rStab.castShadow = true;
    this.modelGroup.add(rStab);

    const lStab = rStab.clone();
    lStab.scale.x = -1;
    lStab.position.x = -0.12;
    this.modelGroup.add(lStab);

    this.elevatorPivot.position.set(0, 0.22, 3.92);
    const elevMesh = new THREE.Mesh(new THREE.BoxGeometry(3.45, 0.048, 0.28), accentMat);
    elevMesh.position.z = 0.14;
    this.elevatorPivot.add(elevMesh);
    this.modelGroup.add(this.elevatorPivot);

    const vFinShape = new THREE.Shape();
    vFinShape.moveTo(0, 0);
    vFinShape.lineTo(1.18, 0);
    vFinShape.lineTo(0.45, 1.58);
    vFinShape.lineTo(-0.08, 1.58);
    vFinShape.closePath();
    const vFinGeo = new THREE.ExtrudeGeometry(vFinShape, {
      depth: 0.1,
      bevelEnabled: true,
      bevelSize: 0.02,
      bevelThickness: 0.02,
      bevelSegments: 2,
    });
    vFinGeo.rotateY(Math.PI / 2);
    vFinGeo.translate(-0.05, 0.2, 2.85);
    const vFin = new THREE.Mesh(vFinGeo, bodyPaintMat);
    vFin.castShadow = true;
    this.modelGroup.add(vFin);

    this.rudderPivot.position.set(0, 0.24, 3.88);
    const rudderMesh = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.4, 0.34), accentMat);
    rudderMesh.position.set(0, 0.66, 0.17);
    this.rudderPivot.add(rudderMesh);
    this.modelGroup.add(this.rudderPivot);

    this.strobeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 });
    this.strobeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), this.strobeMat);
    this.strobeMesh.position.set(0, 1.82, 3.68);
    this.modelGroup.add(this.strobeMesh);

    // 5. Spinning 3-Blade Propeller + Chrome Spinner + Motion-Blur Disc
    this.propHub.position.set(0, 0.0, -3.74);
    const spinnerGeo = new THREE.ConeGeometry(0.28, 0.6, 22);
    spinnerGeo.rotateX(-Math.PI / 2);
    const spinner = new THREE.Mesh(spinnerGeo, chromeMat);
    spinner.position.z = -0.24;
    this.propHub.add(spinner);

    const bladeGeo = new THREE.BoxGeometry(0.13, 1.04, 0.026);
    bladeGeo.translate(0, 0.55, 0);
    for (let b = 0; b < 3; b++) {
      const bladeWrap = new THREE.Group();
      bladeWrap.rotation.z = (b * Math.PI * 2) / 3;
      const blade = new THREE.Mesh(bladeGeo, darkTrimMat);
      blade.rotation.y = 0.26;
      bladeWrap.add(blade);

      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.132, 0.14, 0.028), accentMat);
      tip.position.y = 1.0;
      tip.rotation.y = 0.26;
      bladeWrap.add(tip);

      this.propHub.add(bladeWrap);
    }

    this.propBlurMat = new THREE.MeshBasicMaterial({
      map: this.createPropBlurTexture(),
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.propBlurDisc = new THREE.Mesh(new THREE.PlaneGeometry(2.26, 2.26), this.propBlurMat);
    this.propBlurDisc.position.z = -0.02;
    this.propHub.add(this.propBlurDisc);
    this.modelGroup.add(this.propHub);

    // 6. Retractable Tricycle Landing Gear with Streamlined Wheel Pants
    const buildGearLeg = (xOffset: number, zOffset: number, isNose: boolean): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(xOffset, -0.32, zOffset);

      const strutLen = isNose ? 0.78 : 0.84;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, strutLen, 10), chromeMat);
      strut.position.y = -strutLen * 0.5;
      if (!isNose) strut.rotation.z = xOffset > 0 ? -0.18 : 0.18;
      pivot.add(strut);

      const wheelX = isNose ? 0 : xOffset > 0 ? 0.15 : -0.15;
      const wheelRadius = isNose ? 0.21 : 0.25;
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.13, 18), tireMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wheelX, -strutLen, 0);
      pivot.add(wheel);

      const pantGeo = new THREE.SphereGeometry(wheelRadius * 0.96, 14, 10);
      pantGeo.scale(0.65, 0.72, 1.92);
      const pant = new THREE.Mesh(pantGeo, bodyPaintMat);
      pant.position.set(wheelX, -strutLen + 0.05, 0.03);
      pivot.add(pant);

      return pivot;
    };

    this.noseGearPivot = buildGearLeg(0, -2.55, true);
    this.leftGearPivot = buildGearLeg(-1.12, -0.35, false);
    this.rightGearPivot = buildGearLeg(1.12, -0.35, false);

    this.modelGroup.add(this.noseGearPivot);
    this.modelGroup.add(this.leftGearPivot);
    this.modelGroup.add(this.rightGearPivot);

    this.landingSpot = new THREE.SpotLight(0xfff6dd, 3.0, 220, Math.PI / 6, 0.5, 1.2);
    this.landingSpot.position.set(0, -0.22, -3.55);
    this.landingSpot.target.position.set(0, -1.5, -35);
    this.modelGroup.add(this.landingSpot);
    this.modelGroup.add(this.landingSpot.target);
  }

  private initTrails(scene: THREE.Scene): void {
    for (let i = 0; i < this.trailLength; i++) {
      this.leftTrailPoints.push(new THREE.Vector3());
      this.rightTrailPoints.push(new THREE.Vector3());
    }
    this.leftTrailGeo = new THREE.BufferGeometry().setFromPoints(this.leftTrailPoints);
    this.rightTrailGeo = new THREE.BufferGeometry().setFromPoints(this.rightTrailPoints);
    this.trailMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    this.leftTrailLine = new THREE.Line(this.leftTrailGeo, this.trailMat);
    this.rightTrailLine = new THREE.Line(this.rightTrailGeo, this.trailMat);
    this.leftTrailLine.frustumCulled = false;
    this.rightTrailLine.frustumCulled = false;
    scene.add(this.leftTrailLine);
    scene.add(this.rightTrailLine);
  }

  private initWaterSpray(scene: THREE.Scene): void {
    const count = 90;
    const geo = new THREE.IcosahedronGeometry(0.45, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xf4fbff,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.sprayMesh = new THREE.InstancedMesh(geo, mat, count);
    this.sprayMesh.frustumCulled = false;

    for (let i = 0; i < count; i++) {
      this.sprayParticles.push({
        pos: new THREE.Vector3(0, -500, 0),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.65,
        size: 1.0,
      });
      this.sprayDummy.position.set(0, -500, 0);
      this.sprayDummy.scale.setScalar(0.001);
      this.sprayDummy.updateMatrix();
      this.sprayMesh.setMatrixAt(i, this.sprayDummy.matrix);
    }
    this.sprayMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.sprayMesh);
  }

  public resetTrails(pos: THREE.Vector3): void {
    for (let i = 0; i < this.trailLength; i++) {
      this.leftTrailPoints[i].copy(pos);
      this.rightTrailPoints[i].copy(pos);
    }
  }

  public getVariant(): AircraftVariantId {
    return this.currentVariant;
  }

  public setExteriorVisible(visible: boolean): void {
    this.modelGroup.visible = visible;
  }

  public update(dt: number, elapsed: number, telemetry: FlightTelemetry, nightLights: number): void {
    this.root.position.copy(telemetry.position);
    this.root.quaternion.copy(telemetry.quaternion);
    this.root.updateMatrixWorld();

    const spinSpeed = 14 + telemetry.rpmNormalized * 52;
    this.propHub.rotation.z += spinSpeed * dt;
    this.propBlurMat.opacity = clamp(telemetry.rpmNormalized * 0.78, 0.08, 0.75);

    if (this.pilotScarf) {
      this.pilotScarf.rotation.y = Math.sin(elapsed * 14) * 0.24;
      this.pilotScarf.rotation.x = Math.cos(elapsed * 11) * 0.12;
    }

    const maxAil = 0.42;
    this.leftAileronPivot.rotation.x = telemetry.aileronInput * maxAil;
    this.rightAileronPivot.rotation.x = -telemetry.aileronInput * maxAil;
    this.elevatorPivot.rotation.x = -telemetry.elevatorInput * 0.38;
    this.rudderPivot.rotation.y = -telemetry.rudderInput * 0.42;

    const spoilerAngle = telemetry.airbrakeAnim * 0.85;
    this.leftAirbrakePivot.rotation.x = -spoilerAngle;
    this.rightAirbrakePivot.rotation.x = -spoilerAngle;

    const retract = 1.0 - telemetry.gearDeployAnim;
    this.noseGearPivot.rotation.x = retract * 1.45;
    this.leftGearPivot.rotation.z = -retract * 1.42;
    this.rightGearPivot.rotation.z = retract * 1.42;
    const gearVis = telemetry.gearDeployAnim > 0.03;
    this.noseGearPivot.visible = gearVis;
    this.leftGearPivot.visible = gearVis;
    this.rightGearPivot.visible = gearVis;

    const strobeFlash = Math.sin(elapsed * 7.5) > 0.86 ? 1.0 : 0.15;
    this.strobeMat.opacity = strobeFlash;
    this.strobeMesh.scale.setScalar(strobeFlash > 0.5 ? 1.35 : 0.8);
    this.landingSpot.intensity = telemetry.gearDown ? 1.2 + nightLights * 6.0 : 0.0;

    // Wingtip vapor trails
    this.leftTipWorld.copy(this.leftTipLocal).applyMatrix4(this.root.matrixWorld);
    this.rightTipWorld.copy(this.rightTipLocal).applyMatrix4(this.root.matrixWorld);

    for (let i = this.trailLength - 1; i > 0; i--) {
      this.leftTrailPoints[i].copy(this.leftTrailPoints[i - 1]);
      this.rightTrailPoints[i].copy(this.rightTrailPoints[i - 1]);
    }
    this.leftTrailPoints[0].copy(this.leftTipWorld);
    this.rightTrailPoints[0].copy(this.rightTipWorld);
    this.leftTrailGeo.setFromPoints(this.leftTrailPoints);
    this.rightTrailGeo.setFromPoints(this.rightTrailPoints);

    const bankIntensity = clamp((Math.abs(telemetry.rollDeg) - 12) / 45, 0, 1);
    const speedFactor = clamp((telemetry.airspeedKts - 55) / 80, 0, 1);
    const vaporOpacity = clamp((0.12 + bankIntensity * 0.25 + telemetry.cloudDensity * 0.25) * speedFactor, 0, 0.36);
    this.trailMat.opacity = vaporOpacity;
    this.leftTrailLine.visible = vaporOpacity > 0.02 && !telemetry.onGround;
    this.rightTrailLine.visible = vaporOpacity > 0.02 && !telemetry.onGround;

    // 3D Water Skimming Spray & Wake Foam Plumes!
    this.updateWaterSpray(dt, telemetry);
  }

  private updateWaterSpray(dt: number, telemetry: FlightTelemetry): void {
    const intensity = telemetry.waterSkimIntensity;
    if (intensity > 0.06) {
      this.tmpBackVec.copy(telemetry.forward).negate();
      this.tmpSideVec.crossVectors(telemetry.forward, telemetry.up).normalize();
      const emitCount = Math.ceil(intensity * 5);

      for (let e = 0; e < emitCount; e++) {
        const p = this.sprayParticles[this.sprayCursor];
        this.sprayCursor = (this.sprayCursor + 1) % this.sprayParticles.length;

        const side = e % 2 === 0 ? 1 : -1;
        p.pos
          .copy(telemetry.position)
          .addScaledVector(this.tmpSideVec, side * (1.1 + Math.random() * 1.4))
          .addScaledVector(this.tmpBackVec, 1.0 + Math.random() * 1.6);
        p.pos.y -= 0.75;

        p.vel
          .copy(this.tmpBackVec)
          .multiplyScalar(10 + Math.random() * 14)
          .addScaledVector(this.tmpSideVec, side * (3.5 + Math.random() * 6.5));
        p.vel.y = 3.2 + Math.random() * 5.4 * intensity;

        p.maxLife = 0.55 + Math.random() * 0.45;
        p.life = p.maxLife;
        p.size = 0.65 + Math.random() * 1.15 * intensity;
      }
    }

    let anyAlive = false;
    for (let i = 0; i < this.sprayParticles.length; i++) {
      const p = this.sprayParticles[i];
      if (p.life > 0) {
        anyAlive = true;
        p.life -= dt;
        p.vel.y -= 13.5 * dt;
        p.pos.addScaledVector(p.vel, dt);
        const frac = clamp(p.life / p.maxLife, 0, 1);
        const sc = p.size * (0.35 + (1 - frac) * 1.7) * frac;
        this.sprayDummy.position.copy(p.pos);
        this.sprayDummy.scale.setScalar(Math.max(0.001, sc));
      } else {
        this.sprayDummy.position.set(0, -500, 0);
        this.sprayDummy.scale.setScalar(0.001);
      }
      this.sprayDummy.updateMatrix();
      this.sprayMesh.setMatrixAt(i, this.sprayDummy.matrix);
    }

    this.sprayMesh.visible = anyAlive;
    if (anyAlive) {
      this.sprayMesh.instanceMatrix.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.leftTrailGeo.dispose();
    this.rightTrailGeo.dispose();
    this.trailMat.dispose();
    this.sprayMesh.geometry.dispose();
    this.panelBumpTex.dispose();
  }
}
