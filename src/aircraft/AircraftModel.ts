import * as THREE from 'three';
import { AircraftSpec, AircraftVariantId, FlightTelemetry } from '../types';
import { clamp } from '../utils/noise';

export const AIRCRAFT_SPECS: Record<AircraftVariantId, AircraftSpec> = {
  cloudrunner: {
    id: 'cloudrunner',
    name: 'Cloudrunner SR-1',
    subtitle: 'Sleek Low-Wing Scenic Cruiser',
    description:
      'Inspired by classic touring monoplanes: crisp pearl-white clearcoat with crimson wing accents, panoramic bubble canopy, and balanced handling.',
    cruiseSpeedKts: 118,
    maxSpeedKts: 168,
    stallSpeedKts: 46,
    rollRate: 1.55,
    pitchRate: 1.12,
    yawRate: 0.72,
    liftFactor: 1.0,
    wingSpan: 11.2,
    accentColor: '#d63638',
  },
  skyhawk: {
    id: 'skyhawk',
    name: 'Skyhawk Valley 180',
    subtitle: 'High-Wing Bush & Canyon Explorer',
    description:
      'Strut-braced high-wing cruiser with sapphire trim, generous low-speed lift, and effortless short-field runway landings.',
    cruiseSpeedKts: 106,
    maxSpeedKts: 148,
    stallSpeedKts: 40,
    rollRate: 1.25,
    pitchRate: 1.05,
    yawRate: 0.78,
    liftFactor: 1.14,
    wingSpan: 11.6,
    accentColor: '#1d6fd6',
  },
  albatross: {
    id: 'albatross',
    name: 'Albatross Glide-X',
    subtitle: 'Long-Span Cloud Soarer',
    description:
      'Graceful high-aspect-ratio touring motor-glider with pearl-silver finish and emerald tips—built for floating silently beside giant cloud towers.',
    cruiseSpeedKts: 98,
    maxSpeedKts: 142,
    stallSpeedKts: 36,
    rollRate: 1.1,
    pitchRate: 0.98,
    yawRate: 0.68,
    liftFactor: 1.28,
    wingSpan: 14.4,
    accentColor: '#179973',
  },
};

export const AIRCRAFT_ORDER: AircraftVariantId[] = ['cloudrunner', 'skyhawk', 'albatross'];

export class AircraftModel {
  public readonly root = new THREE.Group();
  public readonly cockpitAnchor = new THREE.Object3D();

  private modelGroup = new THREE.Group();
  private propHub = new THREE.Group();
  private propBlurDisc!: THREE.Mesh;
  private propBlurMat!: THREE.MeshBasicMaterial;

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

  private currentVariant: AircraftVariantId = 'cloudrunner';

  constructor(scene: THREE.Scene) {
    this.root.add(this.modelGroup);
    this.root.add(this.cockpitAnchor);
    scene.add(this.root);

    this.initTrails(scene);
    this.buildVariant('cloudrunner');
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
    // Custom smooth NACA-like airfoil cross-section extruded with spanwise taper
    const shape = new THREE.Shape();
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = (0.32 - t) * chord; // Positive Z/X orientation mapped cleanly later
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

    // Apply spanwise taper & rotate so span runs along +X, chord along -Z (aircraft forward = -Z)
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i); // chord (-back to +front)
      const py = pos.getY(i); // thickness (up/down)
      const pz = pos.getZ(i); // span (0..span)
      const sFrac = clamp(pz / Math.max(span, 0.01), 0, 1);
      const scale = THREE.MathUtils.lerp(1.0, taper, sFrac);
      const sweep = -sFrac * chord * 0.18;
      // Map: aircraft X = pz (span), aircraft Y = py * scale, aircraft Z = -px * scale - sweep
      pos.setXYZ(i, pz, py * scale, -px * scale - sweep);
    }
    geo.computeVertexNormals();
    return geo;
  }

  public buildVariant(variant: AircraftVariantId): void {
    this.currentVariant = variant;
    const spec = AIRCRAFT_SPECS[variant];

    // Clear previous model children cleanly
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

    // PBR Materials
    const bodyPaintMat = new THREE.MeshPhysicalMaterial({
      color: variant === 'albatross' ? 0xf2f6fa : 0xfafcff,
      roughness: 0.2,
      metalness: variant === 'albatross' ? 0.22 : 0.08,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
    });

    const accentMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(spec.accentColor),
      roughness: 0.24,
      metalness: 0.14,
      clearcoat: 0.85,
    });

    const darkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x1f2630,
      roughness: 0.45,
      metalness: 0.55,
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xdde5ee,
      roughness: 0.14,
      metalness: 0.92,
    });

    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x1a1c1f,
      roughness: 0.88,
      metalness: 0.05,
    });

    const glassCanopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x99bfd9,
      roughness: 0.06,
      metalness: 0.05,
      transparent: true,
      opacity: 0.42,
      reflectivity: 0.95,
      clearcoat: 1.0,
      side: THREE.DoubleSide,
    });

    // 1. Sleek Aerodynamic Lathe Fuselage (Aircraft forward = -Z, length ~ 7.6m)
    const fuseProfile: THREE.Vector2[] = [
      new THREE.Vector2(0.01, -3.75), // Nose spinner tip
      new THREE.Vector2(0.32, -3.35),
      new THREE.Vector2(0.56, -2.55), // Engine cowling
      new THREE.Vector2(0.66, -1.35), // Firewall / windshield base
      new THREE.Vector2(0.68, -0.15), // Cabin widest
      new THREE.Vector2(0.58, 1.05),  // Rear cabin taper
      new THREE.Vector2(0.38, 2.35),  // Tailboom
      new THREE.Vector2(0.20, 3.65),  // Empennage root
      new THREE.Vector2(0.04, 4.05),  // Tail cone tip
    ];
    const fuseGeo = new THREE.LatheGeometry(fuseProfile, 28);
    fuseGeo.rotateX(Math.PI / 2);
    // Slightly ovalize cross-section (taller cabin, sleek flanks)
    fuseGeo.scale(0.94, 1.04, 1.0);
    fuseGeo.computeVertexNormals();

    const fuselage = new THREE.Mesh(fuseGeo, bodyPaintMat);
    fuselage.castShadow = true;
    fuselage.receiveShadow = true;
    this.modelGroup.add(fuselage);

    // Sleek accent racing stripe along fuselage flanks
    const stripeGeo = new THREE.BoxGeometry(1.32, 0.14, 5.4);
    const stripeMesh = new THREE.Mesh(stripeGeo, accentMat);
    stripeMesh.position.set(0, 0.02, 0.35);
    this.modelGroup.add(stripeMesh);

    // Engine air intakes on nose cowling
    const intakeGeo = new THREE.BoxGeometry(0.84, 0.18, 0.45);
    const intake = new THREE.Mesh(intakeGeo, darkTrimMat);
    intake.position.set(0, -0.18, -3.15);
    this.modelGroup.add(intake);

    // 2. Cockpit Interior, Instrument Glareshield, Glowing PFD, Control Yoke & Pilot!
    const isHighWing = variant === 'skyhawk';
    const cockpitGroup = new THREE.Group();
    const tub = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.45, 1.75), darkTrimMat);
    tub.position.set(0, 0.25, -0.35);
    cockpitGroup.add(tub);

    // Instrument panel + glowing glass avionics screen (great for Cockpit Camera!)
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.38, 0.28), darkTrimMat);
    dash.position.set(0, 0.56, -1.12);
    cockpitGroup.add(dash);

    const pfdScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    pfdScreen.position.set(-0.16, 0.59, -0.97);
    cockpitGroup.add(pfdScreen);

    const mfdScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x34d399 })
    );
    mfdScreen.position.set(0.2, 0.59, -0.97);
    cockpitGroup.add(mfdScreen);

    // Pilot headrest / silhouette (hidden automatically when in first-person cockpit view via camera clipping or offset)
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.14), darkTrimMat);
    seatBack.position.set(0, 0.58, 0.08);
    cockpitGroup.add(seatBack);

    this.modelGroup.add(cockpitGroup);

    // Panoramic Tinted Bubble Canopy + Canopy Frame Arch
    const canopyGeo = new THREE.SphereGeometry(0.62, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.52);
    canopyGeo.scale(0.92, 0.84, 1.95);
    const canopy = new THREE.Mesh(canopyGeo, glassCanopyMat);
    canopy.position.set(0, 0.44, -0.38);
    this.modelGroup.add(canopy);

    const canopyArch = new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.025, 8, 24, Math.PI),
      bodyPaintMat
    );
    canopyArch.position.set(0, 0.44, -0.45);
    this.modelGroup.add(canopyArch);

    // Set Cockpit First-Person Camera Anchor (looking forward over nose & glowing PFD)
    this.cockpitAnchor.position.set(0, 0.82, -0.32);

    // 3. Main Wings + Accent Wingtips + Winglets (inspired by ref.mp4 red wing roundels/tips!)
    const halfSpan = spec.wingSpan * 0.5;
    const wingY = isHighWing ? 0.88 : -0.22;
    const dihedral = isHighWing ? 0.02 : 0.068;
    const chord = variant === 'albatross' ? 1.32 : 1.58;

    const rightWingGeo = this.createAirfoilExtrude(chord, 0.13, halfSpan - 0.42, variant === 'albatross' ? 0.55 : 0.68);
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

    // Wingtip accent stripes / emblems (homage to ref.mp4 wing markings!)
    const tipDecalGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.03, 20);
    const rightDecal = new THREE.Mesh(tipDecalGeo, accentMat);
    rightDecal.position.set(halfSpan - 1.45, 0.08, 0.35);
    rightWingHolder.add(rightDecal);

    const leftDecal = rightDecal.clone();
    leftDecal.position.x = -(halfSpan - 1.45);
    leftWingHolder.add(leftDecal);

    // Swept aerodynamic winglets
    const wingletGeo = new THREE.BoxGeometry(0.06, 0.52, 0.52);
    const rWinglet = new THREE.Mesh(wingletGeo, accentMat);
    rWinglet.position.set(halfSpan - 0.42, 0.22, 0.42);
    rWinglet.rotation.z = -0.22;
    rightWingHolder.add(rWinglet);

    const lWinglet = new THREE.Mesh(wingletGeo, accentMat);
    lWinglet.position.set(-(halfSpan - 0.42), 0.22, 0.42);
    lWinglet.rotation.z = 0.22;
    leftWingHolder.add(lWinglet);

    // Wing struts for High-Wing Skyhawk variant
    if (isHighWing) {
      const strutGeo = new THREE.CylinderGeometry(0.03, 0.03, 2.55, 8);
      const rStrut = new THREE.Mesh(strutGeo, bodyPaintMat);
      rStrut.position.set(1.55, 0.26, -0.35);
      rStrut.rotation.z = -1.08;
      this.modelGroup.add(rStrut);

      const lStrut = rStrut.clone();
      lStrut.position.x = -1.55;
      lStrut.rotation.z = 1.08;
      this.modelGroup.add(lStrut);
    }

    // Moving Ailerons on outer wings
    const ailSpan = halfSpan * 0.36;
    const ailGeo = new THREE.BoxGeometry(ailSpan, 0.055, 0.32);
    ailGeo.translate(0, 0, 0.16);

    this.rightAileronPivot.position.set(halfSpan * 0.62, -0.01, chord * 0.62);
    const rAil = new THREE.Mesh(ailGeo, accentMat);
    this.rightAileronPivot.add(rAil);
    rightWingHolder.add(this.rightAileronPivot);

    this.leftAileronPivot.position.set(-halfSpan * 0.62, -0.01, chord * 0.62);
    const lAil = new THREE.Mesh(ailGeo, accentMat);
    this.leftAileronPivot.add(lAil);
    leftWingHolder.add(this.leftAileronPivot);

    // Deployable upper-wing Airbrake Spoilers
    const spoilerGeo = new THREE.BoxGeometry(halfSpan * 0.28, 0.03, 0.22);
    spoilerGeo.translate(0, 0, 0.11);
    this.rightAirbrakePivot.position.set(halfSpan * 0.28, 0.09, chord * 0.28);
    this.rightAirbrakePivot.add(new THREE.Mesh(spoilerGeo, darkTrimMat));
    rightWingHolder.add(this.rightAirbrakePivot);

    this.leftAirbrakePivot.position.set(-halfSpan * 0.28, 0.09, chord * 0.28);
    this.leftAirbrakePivot.add(new THREE.Mesh(spoilerGeo, darkTrimMat));
    leftWingHolder.add(this.leftAirbrakePivot);

    // Red (Port) & Green (Starboard) Navigation Lights on wingtips!
    const navGeo = new THREE.SphereGeometry(0.075, 10, 10);
    const portNav = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: 0xff2e2e }));
    portNav.position.set(-(halfSpan - 0.4), 0.04, 0.22);
    leftWingHolder.add(portNav);

    const stbdNav = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: 0x22ff66 }));
    stbdNav.position.set(halfSpan - 0.4, 0.04, 0.22);
    rightWingHolder.add(stbdNav);

    this.modelGroup.add(rightWingHolder);
    this.modelGroup.add(leftWingHolder);

    // Store wingtip local coords for vapor trails
    this.leftTipLocal.set(-halfSpan, wingY + Math.sin(dihedral) * halfSpan, -0.1);
    this.rightTipLocal.set(halfSpan, wingY + Math.sin(dihedral) * halfSpan, -0.1);

    // 4. Tail Empennage: Horizontal Stabilizer + Moving Elevator + Vertical Fin + Moving Rudder
    const hStabSpan = 1.85;
    const rStabGeo = this.createAirfoilExtrude(0.92, 0.1, hStabSpan, 0.62);
    const rStab = new THREE.Mesh(rStabGeo, bodyPaintMat);
    rStab.position.set(0.12, 0.22, 3.35);
    rStab.castShadow = true;
    this.modelGroup.add(rStab);

    const lStab = rStab.clone();
    lStab.scale.x = -1;
    lStab.position.x = -0.12;
    this.modelGroup.add(lStab);

    // Moving Elevator
    this.elevatorPivot.position.set(0, 0.22, 3.92);
    const elevMesh = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.045, 0.28), accentMat);
    elevMesh.position.z = 0.14;
    this.elevatorPivot.add(elevMesh);
    this.modelGroup.add(this.elevatorPivot);

    // Swept Vertical Tail Fin
    const vFinShape = new THREE.Shape();
    vFinShape.moveTo(0, 0);
    vFinShape.lineTo(1.15, 0);
    vFinShape.lineTo(0.45, 1.55);
    vFinShape.lineTo(-0.08, 1.55);
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

    // Moving Rudder
    this.rudderPivot.position.set(0, 0.24, 3.88);
    const rudderMesh = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.38, 0.34), accentMat);
    rudderMesh.position.set(0, 0.66, 0.17);
    this.rudderPivot.add(rudderMesh);
    this.modelGroup.add(this.rudderPivot);

    // White Tail Strobe Light
    this.strobeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.strobeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), this.strobeMat);
    this.strobeMesh.position.set(0, 1.78, 3.68);
    this.modelGroup.add(this.strobeMesh);

    // 5. Spinning 3-Blade Propeller + Chrome Spinner + Motion-Blur Disc
    this.propHub.position.set(0, 0.0, -3.72);
    const spinnerGeo = new THREE.ConeGeometry(0.28, 0.58, 20);
    spinnerGeo.rotateX(-Math.PI / 2);
    const spinner = new THREE.Mesh(spinnerGeo, chromeMat);
    spinner.position.z = -0.24;
    this.propHub.add(spinner);

    const bladeGeo = new THREE.BoxGeometry(0.13, 1.02, 0.026);
    bladeGeo.translate(0, 0.55, 0);
    for (let b = 0; b < 3; b++) {
      const bladeWrap = new THREE.Group();
      bladeWrap.rotation.z = (b * Math.PI * 2) / 3;
      const blade = new THREE.Mesh(bladeGeo, darkTrimMat);
      blade.rotation.y = 0.26; // Realistic blade pitch angle
      bladeWrap.add(blade);

      // Crisp white/safety-accent blade tip
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.132, 0.14, 0.028), accentMat);
      tip.position.y = 0.99;
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
    this.propBlurDisc = new THREE.Mesh(new THREE.PlaneGeometry(2.24, 2.24), this.propBlurMat);
    this.propBlurDisc.position.z = -0.02;
    this.propHub.add(this.propBlurDisc);
    this.modelGroup.add(this.propHub);

    // 6. Retractable / Toggleable Tricycle Landing Gear with Aerodynamic Wheel Pants
    const buildGearLeg = (xOffset: number, zOffset: number, isNose: boolean): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(xOffset, -0.32, zOffset);

      const strutLen = isNose ? 0.78 : 0.84;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, strutLen, 10), chromeMat);
      strut.position.y = -strutLen * 0.5;
      if (!isNose) strut.rotation.z = xOffset > 0 ? -0.18 : 0.18;
      pivot.add(strut);

      const wheelX = isNose ? 0 : xOffset > 0 ? 0.15 : -0.15;
      const wheelRadius = isNose ? 0.21 : 0.25;
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.13, 18), tireMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wheelX, -strutLen, 0);
      pivot.add(wheel);

      // Streamlined wheel pant fairing (just like ref.mp4!)
      const pantGeo = new THREE.SphereGeometry(wheelRadius * 0.95, 14, 10);
      pantGeo.scale(0.65, 0.72, 1.9);
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

    // Nose Landing Light
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
    // Even in cockpit view we keep wings, nose cowling, and prop visible!
    this.modelGroup.visible = visible;
  }

  public update(dt: number, elapsed: number, telemetry: FlightTelemetry, nightLights: number): void {
    this.root.position.copy(telemetry.position);
    this.root.quaternion.copy(telemetry.quaternion);
    this.root.updateMatrixWorld();

    // 1. Spin propeller & blend motion-blur disc smoothly by RPM
    const spinSpeed = 14 + telemetry.rpmNormalized * 52;
    this.propHub.rotation.z += spinSpeed * dt;
    this.propBlurMat.opacity = clamp(telemetry.rpmNormalized * 0.78, 0.08, 0.75);

    // 2. Deflect aerodynamic control surfaces authentically!
    const maxAil = 0.42;
    this.leftAileronPivot.rotation.x = telemetry.aileronInput * maxAil;
    this.rightAileronPivot.rotation.x = -telemetry.aileronInput * maxAil;
    this.elevatorPivot.rotation.x = -telemetry.elevatorInput * 0.38;
    this.rudderPivot.rotation.y = -telemetry.rudderInput * 0.42;

    // 3. Airbrake upper-wing spoilers
    const spoilerAngle = telemetry.airbrakeAnim * 0.85;
    this.leftAirbrakePivot.rotation.x = -spoilerAngle;
    this.rightAirbrakePivot.rotation.x = -spoilerAngle;

    // 4. Retractable Landing Gear animation (0 = retracted flush, 1 = deployed)
    const retract = 1.0 - telemetry.gearDeployAnim;
    this.noseGearPivot.rotation.x = retract * 1.45;
    this.leftGearPivot.rotation.z = -retract * 1.42;
    this.rightGearPivot.rotation.z = retract * 1.42;
    const gearVis = telemetry.gearDeployAnim > 0.03;
    this.noseGearPivot.visible = gearVis;
    this.leftGearPivot.visible = gearVis;
    this.rightGearPivot.visible = gearVis;

    // 5. Navigation strobe & landing beam
    const strobeFlash = Math.sin(elapsed * 7.5) > 0.86 ? 1.0 : 0.15;
    this.strobeMat.opacity = strobeFlash;
    this.strobeMesh.scale.setScalar(strobeFlash > 0.5 ? 1.35 : 0.8);
    this.landingSpot.intensity = telemetry.gearDown ? 1.2 + nightLights * 6.0 : 0.0;

    // 6. Subtle wingtip condensation trails when banking, high speed, or flying in humid clouds!
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
  }

  public dispose(): void {
    this.leftTrailGeo.dispose();
    this.rightTrailGeo.dispose();
    this.trailMat.dispose();
  }
}
