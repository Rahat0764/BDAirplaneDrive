import * as THREE from 'three';
import { AtmospherePreset, GameplayModeId, GraphicsConfig } from '../types';
import { clamp, hash2, noise3D, smoothstep } from '../utils/noise';

interface CloudClusterDef {
  baseX: number;
  baseY: number;
  baseZ: number;
  radius: number;
  height: number;
  kind: 'canyon_tower' | 'castle' | 'scattered' | 'blanket' | 'mist';
  extraExplorationOnly: boolean;
}

interface LobeData {
  clusterIndex: number;
  localOffset: THREE.Vector3;
  scale: THREE.Vector3;
  macroNormalBias: THREE.Vector3;
  heightFraction: number; // 0 = base of cloud tower, 1 = sunlit crown
  seed: number;
}

const CLOUD_VOLUME_VERT = /* glsl */ `
attribute vec3 aMacroBias;
attribute vec2 aCloudMeta; // x: heightFraction, y: seed

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vMacroBias;
varying vec2 vCloudMeta;
varying float vViewDist;

uniform float uTime;
uniform vec2 uWindOffset;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash13(i + vec3(0, 0, 0)), hash13(i + vec3(1, 0, 0)), f.x),
      mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x),
      f.y
    ),
    mix(
      mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
      mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x),
      f.y
    ),
    f.z
  );
}

float billow3(vec3 p) {
  float n1 = vnoise(p);
  float n2 = vnoise(p * 2.07 + vec3(13.4, 7.1, 19.8));
  float b1 = 1.0 - abs(n1 * 2.0 - 1.0);
  float b2 = 1.0 - abs(n2 * 2.0 - 1.0);
  return (1.0 - b1 * b1) * 0.68 + (1.0 - b2 * b2) * 0.32;
}

void main() {
  vMacroBias = aMacroBias;
  vCloudMeta = aCloudMeta;

  // Sculpt organic cauliflower cumulus puffs on GPU vertices
  vec3 nrm = normalize(normal);
  vec3 sampleP = nrm * 1.85 + vec3(aCloudMeta.y * 11.3, aCloudMeta.x * 5.7, uTime * 0.015);
  float puff = billow3(sampleP);
  // Flatten underside slightly like real condensation level, billow top crowns
  float topBoost = smoothstep(-0.3, 0.8, nrm.y);
  vec3 displaced = position * (0.78 + puff * (0.34 + 0.16 * topBoost));

  vec4 worldPos = instanceMatrix * vec4(displaced, 1.0);
  worldPos.xz += uWindOffset;

  // Approximate perturbed world normal
  mat3 instMat3 = mat3(instanceMatrix);
  vWorldNormal = normalize(instMat3 * nrm);
  vWorldPos = worldPos.xyz;

  vec4 mvPos = viewMatrix * worldPos;
  vViewDist = -mvPos.z;
  gl_Position = projectionMatrix * mvPos;
}
`;

const CLOUD_VOLUME_FRAG = /* glsl */ `
precision highp float;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vMacroBias;
varying vec2 vCloudMeta;
varying float vViewDist;

uniform vec3 uSunDir;
uniform vec3 uCloudBright;
uniform vec3 uCloudMid;
uniform vec3 uCloudShadow;
uniform vec3 uCloudRim;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uDrawDist;
uniform float uTime;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash13(i + vec3(0, 0, 0)), hash13(i + vec3(1, 0, 0)), f.x),
      mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x),
      f.y
    ),
    mix(
      mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
      mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x),
      f.y
    ),
    f.z
  );
}

float fbmCloud(vec3 p) {
  float sum = 0.0;
  float amp = 0.54;
  for (int i = 0; i < 4; i++) {
    float n = vnoise(p);
    float crisp = 1.0 - abs(n * 2.0 - 1.0);
    sum += amp * mix(n, 1.0 - crisp * crisp, 0.58);
    p = p * 2.13 + vec3(19.1, 7.7, 11.3);
    amp *= 0.47;
  }
  return sum;
}

float hgPhase(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(0.04, 1.0 + g2 - 2.0 * g * cosTheta), 1.5));
}

void main() {
  if (vViewDist > uDrawDist) discard;

  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 geomN = normalize(vWorldNormal);

  // Sample multi-scale 3D volumetric cloud detail in world space
  vec3 noiseCoord = vWorldPos * 0.0085 + vec3(vCloudMeta.y * 5.0, uTime * 0.004, 0.0);
  float fDetail = fbmCloud(noiseCoord);
  float fFine = vnoise(vWorldPos * 0.036 + vec3(3.1, 1.7, 8.4));

  // Perturb normal with 3D cloud billow gradient for ultra-detailed cumulus folds!
  float eps = 0.22;
  float nx = fbmCloud(noiseCoord + vec3(eps, 0.0, 0.0)) - fDetail;
  float ny = fbmCloud(noiseCoord + vec3(0.0, eps, 0.0)) - fDetail;
  float nz = fbmCloud(noiseCoord + vec3(0.0, 0.0, eps)) - fDetail;
  vec3 detailGrad = vec3(nx, ny, nz) * 2.6;

  // Blend puff normal, macro cloud-tower normal, and micro cauliflower bump!
  vec3 macroN = normalize(mix(geomN, normalize(vMacroBias + vec3(0.0, 0.25, 0.0)), 0.44) - detailGrad);

  // Feathered volumetric silhouette erosion so edges look fluffy & soft, never polygonal!
  float ndv = clamp(dot(geomN, V), 0.0, 1.0);
  float edgeDensity = ndv * 1.28 + (fDetail - 0.46) * 0.85 + (fFine - 0.5) * 0.22;

  // Smooth camera proximity fade when flying right inside a lobe (prevents harsh wall clipping!)
  float nearFade = smoothstep(14.0, 68.0, vViewDist);
  float farFade = 1.0 - smoothstep(uDrawDist * 0.78, uDrawDist, vViewDist);

  // Screen-door stochastic alpha + smooth test for artifact-free volumetric cloud edges
  vec2 screenHashP = gl_FragCoord.xy + vec2(vCloudMeta.y * 97.0);
  float dither = fract(sin(dot(screenHashP, vec2(12.9898, 78.233))) * 43758.5453);
  float effectiveDensity = edgeDensity * nearFade * farFade;
  if (effectiveDensity < 0.20 + dither * 0.14) discard;

  // Direct sunlight + macro tower height + Beer-Powder cumulus scattering!
  float sunDot = dot(macroN, uSunDir);
  float halfLambert = sunDot * 0.5 + 0.5;
  float heightLit = smoothstep(0.0, 0.95, vCloudMeta.x);

  // "Powder" dark-crevice / bright-crown scattering + clean Ghibli sunlit tonal clarity!
  float powder = 1.0 - exp(-effectiveDensity * 2.5);
  float rawEnergy = clamp(
    halfLambert * 0.68 + heightLit * 0.36 + (fDetail - 0.48) * 0.30,
    0.0,
    1.15
  );
  float smoothEnergy = mix(rawEnergy * 0.74, rawEnergy, powder);

  // Subtle clean Ghibli-inspired 3-tier tonal crispness blended seamlessly with realistic volumetric gradient
  float ghibliBand = smoothstep(0.24, 0.34, smoothEnergy) * 0.46 + smoothstep(0.56, 0.68, smoothEnergy) * 0.54;
  float lightEnergy = mix(smoothEnergy, ghibliBand, 0.36);

  // Multi-stop luminous cloud palette: clean cerulean shadow -> soft sky-periwinkle mid -> warm sunlit ivory crown
  vec3 col = mix(uCloudShadow, uCloudMid, smoothstep(0.08, 0.50, lightEnergy));
  col = mix(col, uCloudBright, smoothstep(0.45, 0.88, lightEnergy));

  // Silver lining forward scattering when looking near the sun/moon through cloud edges!
  float viewSunCos = dot(-V, uSunDir);
  float phase = clamp(hgPhase(viewSunCos, 0.62), 0.0, 2.2);
  float rimFactor = pow(1.0 - ndv, 2.2) * (0.35 + 0.65 * heightLit);
  col += uCloudRim * rimFactor * (0.20 + phase * 0.42);

  // Subtle ambient sky bounce in deep shadow folds
  float skyUp = clamp(macroN.y * 0.5 + 0.5, 0.0, 1.0);
  col += uSkyHorizon * (1.0 - lightEnergy) * skyUp * 0.08;

  // Exponential atmospheric perspective fog matching world terrain & sky horizon
  float fogFactor = 1.0 - exp(-pow(vViewDist * uFogDensity * 0.82, 2.0));
  col = mix(col, mix(uFogColor, uSkyHorizon, 0.45), clamp(fogFactor, 0.0, 0.88));

  gl_FragColor = vec4(col, 1.0);
}
`;

const VAPOR_WISP_VERT = /* glsl */ `
attribute float aRotation;
attribute float aOpacity;

varying vec2 vUv;
varying float vAlpha;
varying float vDist;

uniform float uTime;
uniform vec2 uWindOffset;

void main() {
  vUv = uv;
  vec4 centerWorld = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  centerWorld.xz += uWindOffset * 1.18;

  // Extract scale from instanceMatrix columns
  float sx = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  float sy = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));

  vec4 mvCenter = viewMatrix * centerWorld;
  vDist = -mvCenter.z;

  float rot = aRotation + uTime * 0.012;
  float c = cos(rot);
  float s = sin(rot);
  vec2 rotated = vec2(
    position.x * c - position.y * s,
    position.x * s + position.y * c
  );

  mvCenter.xy += rotated * vec2(sx, sy);

  // Smooth fade when very close or very far so flying right through vapor feels dreamy & seamless!
  float nearFade = smoothstep(8.0, 95.0, vDist);
  float farFade = 1.0 - smoothstep(3200.0, 6200.0, vDist);
  vAlpha = aOpacity * nearFade * farFade;

  gl_Position = projectionMatrix * mvCenter;
}
`;

const VAPOR_WISP_FRAG = /* glsl */ `
precision mediump float;

varying vec2 vUv;
varying float vAlpha;
varying float vDist;

uniform vec3 uCloudBright;
uniform vec3 uCloudMid;
uniform vec3 uFogColor;
uniform float uFogDensity;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  if (vAlpha <= 0.004) discard;
  vec2 centered = vUv * 2.0 - 1.0;
  float radial = 1.0 - dot(centered, centered);
  if (radial <= 0.0) discard;

  float n = noise2(vUv * 4.5) * 0.62 + noise2(vUv * 9.5 + 3.1) * 0.38;
  float mask = pow(radial, 1.65) * smoothstep(0.28, 0.82, n);
  float alpha = mask * vAlpha;
  if (alpha < 0.005) discard;

  vec3 col = mix(uCloudMid, uCloudBright, 0.65 + 0.35 * vUv.y);
  float fog = 1.0 - exp(-pow(vDist * uFogDensity * 0.75, 2.0));
  col = mix(col, uFogColor, clamp(fog, 0.0, 0.85));

  gl_FragColor = vec4(col, alpha);
}
`;

export class CloudSystem {
  public readonly group = new THREE.Group();

  private clusters: CloudClusterDef[] = [];
  private volumeMesh: THREE.InstancedMesh | null = null;
  private vaporMesh: THREE.InstancedMesh | null = null;
  private localMistGroup = new THREE.Group();
  private localMistSprites: THREE.Sprite[] = [];
  private localMistMat: THREE.SpriteMaterial;

  private volumeMaterial: THREE.ShaderMaterial;
  private vaporMaterial: THREE.ShaderMaterial;

  private windVelocity = new THREE.Vector2(5.5, -2.4); // Gentle natural cloud drift (m/s)
  private windOffset = new THREE.Vector2(0, 0);
  private worldWrapSpan = 16000;

  private currentQuality: GraphicsConfig;
  private currentMode: GameplayModeId = 'free_flight';

  constructor(scene: THREE.Scene, quality: GraphicsConfig) {
    this.currentQuality = quality;

    this.volumeMaterial = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VOLUME_VERT,
      fragmentShader: CLOUD_VOLUME_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uWindOffset: { value: this.windOffset },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, -0.5) },
        uCloudBright: { value: new THREE.Color('#ffffff') },
        uCloudMid: { value: new THREE.Color('#dce9f7') },
        uCloudShadow: { value: new THREE.Color('#5a7ba8') },
        uCloudRim: { value: new THREE.Color('#fffef7') },
        uSkyHorizon: { value: new THREE.Color('#7cb4e8') },
        uFogColor: { value: new THREE.Color('#86b9e8') },
        uFogDensity: { value: 0.000095 },
        uDrawDist: { value: quality.drawDistance },
      },
    });

    this.vaporMaterial = new THREE.ShaderMaterial({
      vertexShader: VAPOR_WISP_VERT,
      fragmentShader: VAPOR_WISP_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uWindOffset: { value: this.windOffset },
        uCloudBright: { value: new THREE.Color('#ffffff') },
        uCloudMid: { value: new THREE.Color('#dce9f7') },
        uFogColor: { value: new THREE.Color('#86b9e8') },
        uFogDensity: { value: 0.000095 },
      },
    });

    this.localMistMat = new THREE.SpriteMaterial({
      map: this.createSoftMistTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
    });

    this.generateMacroClusterLayout();
    this.rebuildMeshes();
    this.buildLocalFlyThroughMist();

    this.group.add(this.localMistGroup);
    scene.add(this.group);
  }

  private createSoftMistTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0.0, 'rgba(255,255,255,0.65)');
    grad.addColorStop(0.45, 'rgba(245,250,255,0.28)');
    grad.addColorStop(1.0, 'rgba(240,248,255,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  private generateMacroClusterLayout(): void {
    this.clusters = [];

    // 1. SIGNATURE GRAND CLOUD CANYON (Direct homage to ref.mp4!)
    // Towering left and right cumulus walls framing the emerald valley corridor from z = +700 to z = -6400
    const canyonSteps = 16;
    for (let i = 0; i < canyonSteps; i++) {
      const z = 550 - i * 440 + (hash2(i, 11) - 0.5) * 140;

      // Left towering cumulus wall (particularly tall & dramatic on left like ref.mp4!)
      const leftDist = 470 + hash2(i, 21) * 280;
      const leftTowerH = 950 + hash2(i, 31) * 980 + (i % 3 === 1 ? 380 : 0);
      this.clusters.push({
        baseX: -leftDist,
        baseY: 340 + hash2(i, 41) * 110,
        baseZ: z,
        radius: 260 + hash2(i, 51) * 150,
        height: leftTowerH,
        kind: 'canyon_tower',
        extraExplorationOnly: false,
      });

      // Right towering cumulus wall
      const rightDist = 460 + hash2(i, 61) * 290;
      const rightTowerH = 900 + hash2(i, 71) * 960 + (i % 2 === 0 ? 420 : 0);
      this.clusters.push({
        baseX: rightDist,
        baseY: 330 + hash2(i, 81) * 115,
        baseZ: z - 90,
        radius: 270 + hash2(i, 91) * 160,
        height: rightTowerH,
        kind: 'canyon_tower',
        extraExplorationOnly: false,
      });

      // Lower fluffy canyon-floor shoulder puffs hugging the valley sides
      if (i % 2 === 0) {
        const side = i % 4 === 0 ? -1 : 1;
        this.clusters.push({
          baseX: side * (250 + hash2(i, 101) * 140),
          baseY: 270 + hash2(i, 111) * 80,
          baseZ: z - 180,
          radius: 145 + hash2(i, 121) * 70,
          height: 240 + hash2(i, 131) * 140,
          kind: 'scattered',
          extraExplorationOnly: false,
        });
      }
    }

    // 2. MASSIVE DISTANT CLOUD CASTLES & CUMULONIMBUS TOWERS AROUND THE WORLD
    for (let i = 0; i < 42; i++) {
      const angle = (i / 42) * Math.PI * 2 + hash2(i, 201) * 0.14;
      const ringDist = 2200 + hash2(i, 211) * 6800;
      const x = Math.sin(angle) * ringDist;
      const z = -1500 + Math.cos(angle) * ringDist;
      // Keep airport runway approach corridor clear (around x=0, z=900..3000, low alt)
      if (Math.abs(x) < 650 && z > 650 && z < 3400) continue;

      this.clusters.push({
        baseX: x,
        baseY: 420 + hash2(i, 221) * 260,
        baseZ: z,
        radius: 360 + hash2(i, 231) * 260,
        height: 1100 + hash2(i, 241) * 1350,
        kind: 'castle',
        extraExplorationOnly: i > 28,
      });
    }

    // 3. SCATTERED CUMULUS DECK & WIDE CLOUD BLANKETS WITH SCENIC GAPS
    for (let i = 0; i < 46; i++) {
      const x = (hash2(i, 301) - 0.5) * 15000;
      const z = (hash2(i, 311) - 0.58) * 15000;
      // Leave central canyon centerline & runway open for dramatic valley views
      if (Math.abs(x) < 380 && z > -5500 && z < 3400) continue;

      const isBlanket = i % 3 === 0;
      this.clusters.push({
        baseX: x,
        baseY: isBlanket ? 520 + hash2(i, 321) * 200 : 620 + hash2(i, 331) * 480,
        baseZ: z,
        radius: isBlanket ? 420 + hash2(i, 341) * 240 : 210 + hash2(i, 351) * 140,
        height: isBlanket ? 260 + hash2(i, 361) * 150 : 380 + hash2(i, 371) * 350,
        kind: isBlanket ? 'blanket' : 'scattered',
        extraExplorationOnly: i > 32,
      });
    }

    // 4. EXTRA CLOUD CATHEDRAL ARCHES FOR "CLOUD EXPLORATION" MODE
    for (let i = 0; i < 18; i++) {
      const z = -300 - i * 380;
      const x = Math.sin(i * 0.7) * 340;
      this.clusters.push({
        baseX: x,
        baseY: 740 + (i % 3) * 180,
        baseZ: z,
        radius: 240 + hash2(i, 401) * 120,
        height: 850 + hash2(i, 411) * 650,
        kind: 'castle',
        extraExplorationOnly: true,
      });
    }
  }

  public rebuildMeshes(): void {
    if (this.volumeMesh) {
      this.group.remove(this.volumeMesh);
      this.volumeMesh.geometry.dispose();
      this.volumeMesh = null;
    }
    if (this.vaporMesh) {
      this.group.remove(this.vaporMesh);
      this.vaporMesh.geometry.dispose();
      this.vaporMesh = null;
    }

    const activeClusters = this.clusters.filter(
      (c) => !c.extraExplorationOnly || this.currentMode === 'cloud_exploration'
    );
    const maxClusters = Math.min(activeClusters.length, this.currentQuality.cloudClusterCount);
    const lobesPerCluster = this.currentQuality.cloudLobesPerCluster;

    const lobes: LobeData[] = [];

    for (let ci = 0; ci < maxClusters; ci++) {
      const c = activeClusters[ci];
      const count =
        c.kind === 'canyon_tower' || c.kind === 'castle'
          ? lobesPerCluster
          : Math.max(6, Math.floor(lobesPerCluster * 0.62));

      for (let li = 0; li < count; li++) {
        const frac = count > 1 ? li / (count - 1) : 0.5;
        const r1 = hash2(ci * 37 + li, 501);
        const r2 = hash2(ci * 37 + li, 502);
        const r3 = hash2(ci * 37 + li, 503);

        let ox = 0;
        let oy = 0;
        let oz = 0;
        let sx = 100;
        let sy = 90;
        let sz = 100;

        if (c.kind === 'canyon_tower' || c.kind === 'castle') {
          // Tapered monumental cumulus spire: wide billowy base, stacked cauliflower turrets rising skyward!
          const hCurve = Math.pow(frac, 0.88);
          oy = hCurve * c.height;
          const radialSpread = c.radius * (1.05 - hCurve * 0.56);
          const ang = r1 * Math.PI * 2 + frac * 4.5;
          const rad = radialSpread * (0.25 + 0.75 * Math.sqrt(r2));
          ox = Math.cos(ang) * rad;
          oz = Math.sin(ang) * rad;
          const puffSize = c.radius * (0.64 - hCurve * 0.24) * (0.82 + 0.42 * r3);
          sx = puffSize * (1.0 + 0.2 * r1);
          sy = puffSize * (0.86 + 0.28 * hCurve);
          sz = puffSize * (1.0 + 0.2 * r2);
        } else if (c.kind === 'blanket') {
          const ang = r1 * Math.PI * 2;
          const rad = c.radius * Math.sqrt(r2);
          ox = Math.cos(ang) * rad;
          oz = Math.sin(ang) * rad;
          oy = (r3 - 0.3) * c.height;
          sx = c.radius * (0.42 + 0.28 * r1);
          sy = c.height * (0.48 + 0.25 * r3);
          sz = c.radius * (0.42 + 0.28 * r2);
        } else {
          const ang = r1 * Math.PI * 2;
          const rad = c.radius * 0.75 * Math.sqrt(r2);
          ox = Math.cos(ang) * rad;
          oz = Math.sin(ang) * rad;
          oy = frac * c.height * 0.85;
          const puffSize = c.radius * (0.58 - frac * 0.18) * (0.85 + 0.3 * r3);
          sx = puffSize;
          sy = puffSize * 0.85;
          sz = puffSize;
        }

        const macroBias = new THREE.Vector3(ox, oy - c.height * 0.32, oz);
        if (macroBias.lengthSq() < 0.001) macroBias.set(0, 1, 0);
        macroBias.normalize();

        lobes.push({
          clusterIndex: ci,
          localOffset: new THREE.Vector3(c.baseX + ox, c.baseY + oy, c.baseZ + oz),
          scale: new THREE.Vector3(sx, sy, sz),
          macroNormalBias: macroBias,
          heightFraction: clamp(oy / Math.max(c.height, 1), 0, 1),
          seed: r1 * 10 + r2,
        });
      }
    }

    const detail = this.currentQuality.id === 'low' ? 2 : 3;
    const baseGeo = new THREE.IcosahedronGeometry(1, detail);
    const instMesh = new THREE.InstancedMesh(baseGeo, this.volumeMaterial, lobes.length);
    instMesh.frustumCulled = false;

    const macroBiasArr = new Float32Array(lobes.length * 3);
    const metaArr = new Float32Array(lobes.length * 2);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < lobes.length; i++) {
      const l = lobes[i];
      dummy.position.copy(l.localOffset);
      dummy.rotation.set(l.seed * 0.7, l.seed * 1.3, l.seed * 0.4);
      dummy.scale.copy(l.scale);
      dummy.updateMatrix();
      instMesh.setMatrixAt(i, dummy.matrix);

      macroBiasArr[i * 3 + 0] = l.macroNormalBias.x;
      macroBiasArr[i * 3 + 1] = l.macroNormalBias.y;
      macroBiasArr[i * 3 + 2] = l.macroNormalBias.z;

      metaArr[i * 2 + 0] = l.heightFraction;
      metaArr[i * 2 + 1] = l.seed;
    }

    baseGeo.setAttribute('aMacroBias', new THREE.InstancedBufferAttribute(macroBiasArr, 3));
    baseGeo.setAttribute('aCloudMeta', new THREE.InstancedBufferAttribute(metaArr, 2));
    instMesh.instanceMatrix.needsUpdate = true;

    this.volumeMesh = instMesh;
    this.group.add(instMesh);

    // Build gossamer canyon vapor wisps & low valley mist sheets (like frames 00:03-00:06 of ref.mp4!)
    const wispCount = this.currentQuality.mistParticles * 3;
    const planeGeo = new THREE.PlaneGeometry(1, 1);
    const vaporInst = new THREE.InstancedMesh(planeGeo, this.vaporMaterial, wispCount);
    vaporInst.frustumCulled = false;
    vaporInst.renderOrder = 15;

    const rotArr = new Float32Array(wispCount);
    const opArr = new Float32Array(wispCount);

    for (let i = 0; i < wispCount; i++) {
      const r1 = hash2(i, 701);
      const r2 = hash2(i, 702);
      const r3 = hash2(i, 703);

      let wx: number;
      let wy: number;
      let wz: number;
      let wScale: number;
      let opacity: number;

      if (i < wispCount * 0.55) {
        // Canyon mid-air drifting vapor bridges right along the scenic flight path!
        wx = (r1 - 0.5) * 950;
        wy = 360 + r2 * 560;
        wz = 350 - (i / (wispCount * 0.55)) * 6200 + (r3 - 0.5) * 260;
        wScale = 240 + r3 * 310;
        opacity = 0.20 + r2 * 0.18;
      } else {
        // Low-altitude valley & river mist banks
        wx = (r1 - 0.5) * 7500;
        wy = 95 + r2 * 155;
        wz = (r3 - 0.55) * 9000;
        wScale = 420 + r1 * 480;
        opacity = 0.16 + r3 * 0.14;
      }

      dummy.position.set(wx, wy, wz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(wScale * 1.35, wScale * 0.82, 1);
      dummy.updateMatrix();
      vaporInst.setMatrixAt(i, dummy.matrix);

      rotArr[i] = r1 * Math.PI * 2;
      opArr[i] = opacity;
    }

    planeGeo.setAttribute('aRotation', new THREE.InstancedBufferAttribute(rotArr, 1));
    planeGeo.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(opArr, 1));
    vaporInst.instanceMatrix.needsUpdate = true;

    this.vaporMesh = vaporInst;
    this.group.add(vaporInst);
  }

  private buildLocalFlyThroughMist(): void {
    // Soft vapor puffs in local camera/aircraft vicinity that materialize when entering a cloud!
    for (let i = 0; i < 18; i++) {
      const sp = new THREE.Sprite(this.localMistMat);
      const ang = (i / 18) * Math.PI * 2;
      const dist = 16 + (i % 3) * 14;
      sp.position.set(
        Math.cos(ang) * dist,
        ((i % 5) - 2) * 5.5,
        Math.sin(ang) * dist - 12
      );
      const s = 26 + (i % 4) * 10;
      sp.scale.set(s * 1.3, s, 1);
      sp.renderOrder = 30;
      this.localMistGroup.add(sp);
      this.localMistSprites.push(sp);
    }
  }

  public setGameplayMode(mode: GameplayModeId): void {
    if (this.currentMode !== mode) {
      this.currentMode = mode;
      this.rebuildMeshes();
    }
  }

  public applyPreset(preset: AtmospherePreset, sunDir: THREE.Vector3): void {
    const u = this.volumeMaterial.uniforms;
    u.uSunDir.value.copy(sunDir);
    u.uCloudBright.value.copy(preset.cloudBrightColor);
    u.uCloudMid.value.copy(preset.cloudMidColor);
    u.uCloudShadow.value.copy(preset.cloudShadowColor);
    u.uCloudRim.value.copy(preset.cloudRimColor);
    u.uSkyHorizon.value.copy(preset.skyHorizon);
    u.uFogColor.value.copy(preset.fogColor);
    u.uFogDensity.value = preset.fogDensity;

    const vu = this.vaporMaterial.uniforms;
    vu.uCloudBright.value.copy(preset.cloudBrightColor);
    vu.uCloudMid.value.copy(preset.cloudMidColor);
    vu.uFogColor.value.copy(preset.fogColor);
    vu.uFogDensity.value = preset.fogDensity;

    this.localMistMat.color.copy(preset.cloudBrightColor);
  }

  public applyGraphicsQuality(quality: GraphicsConfig): void {
    const needsRebuild =
      quality.cloudClusterCount !== this.currentQuality.cloudClusterCount ||
      quality.cloudLobesPerCluster !== this.currentQuality.cloudLobesPerCluster ||
      quality.id !== this.currentQuality.id;
    this.currentQuality = quality;
    this.volumeMaterial.uniforms.uDrawDist.value = quality.drawDistance;
    if (needsRebuild) {
      this.rebuildMeshes();
    }
  }

  /**
   * Computes smooth [0..1] volumetric cloud density at any 3D world position
   * so aircraft visibility, mist immersion, fog, and gentle cloud turbulence respond naturally!
   */
  public getCloudDensityAt(worldPos: THREE.Vector3): number {
    let maxD = 0;
    const px = worldPos.x - this.windOffset.x;
    const py = worldPos.y;
    const pz = worldPos.z - this.windOffset.y;

    const limit = Math.min(this.clusters.length, this.currentQuality.cloudClusterCount);
    for (let i = 0; i < limit; i++) {
      const c = this.clusters[i];
      if (c.extraExplorationOnly && this.currentMode !== 'cloud_exploration') continue;

      const minY = c.baseY - c.radius * 0.55;
      const maxY = c.baseY + c.height + c.radius * 0.55;
      if (py < minY || py > maxY) continue;

      const dx = px - c.baseX;
      const dz = pz - c.baseZ;
      const horizR = c.radius * 1.18;
      const d2 = dx * dx + dz * dz;
      if (d2 > horizR * horizR) continue;

      const hFrac = clamp((py - c.baseY) / Math.max(c.height, 1), 0, 1);
      const effectiveR = c.radius * (c.kind === 'blanket' ? 1.1 : 1.1 - hFrac * 0.42);
      const horizDist = Math.sqrt(d2);
      if (horizDist > effectiveR) continue;

      const radialFactor = 1.0 - horizDist / effectiveR;
      const vertFactor = smoothstep(minY, minY + 95, py) * smoothstep(maxY, maxY - 120, py);
      const n = 0.65 + 0.35 * noise3D(px * 0.008, py * 0.008, pz * 0.008);
      const d = clamp(radialFactor * vertFactor * n * 1.65, 0, 1);
      if (d > maxD) maxD = d;
      if (maxD > 0.95) break;
    }

    return maxD;
  }

  public update(dt: number, elapsed: number, aircraftPos: THREE.Vector3, cloudDensity: number): void {
    // Slow, peaceful wind drift without abrupt looping
    this.windOffset.x += this.windVelocity.x * dt;
    this.windOffset.y += this.windVelocity.y * dt;
    if (this.windOffset.length() > this.worldWrapSpan) {
      this.windOffset.multiplyScalar(0.01);
    }

    this.volumeMaterial.uniforms.uTime.value = elapsed;
    this.vaporMaterial.uniforms.uTime.value = elapsed;

    // Local cloud fly-through mist enveloping the aircraft smoothly
    this.localMistGroup.position.copy(aircraftPos);
    const targetOp = smoothstep(0.06, 0.72, cloudDensity) * 0.46;
    this.localMistMat.opacity += (targetOp - this.localMistMat.opacity) * Math.min(1, dt * 5.0);
    this.localMistGroup.visible = this.localMistMat.opacity > 0.008;

    if (this.localMistGroup.visible) {
      for (let i = 0; i < this.localMistSprites.length; i++) {
        const sp = this.localMistSprites[i];
        sp.position.z += dt * 38;
        if (sp.position.z > 28) {
          sp.position.z = -52;
        }
      }
    }
  }

  public dispose(): void {
    if (this.volumeMesh) this.volumeMesh.geometry.dispose();
    if (this.vaporMesh) this.vaporMesh.geometry.dispose();
    this.volumeMaterial.dispose();
    this.vaporMaterial.dispose();
    if (this.localMistMat.map) this.localMistMat.map.dispose();
    this.localMistMat.dispose();
  }
}
