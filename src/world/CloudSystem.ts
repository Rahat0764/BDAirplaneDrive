import * as THREE from 'three';
import { AtmospherePreset, GameplayModeId, GraphicsConfig, WeatherConfig } from '../types';
import { clamp, hash2, noise3D, smoothstep } from '../utils/noise';

interface CloudClusterDef {
  baseX: number;
  baseY: number;
  baseZ: number;
  radius: number;
  height: number;
  kind: 'canyon_tower' | 'castle' | 'scattered' | 'blanket';
  extraExplorationOnly: boolean;
}

interface PuffData {
  clusterIndex: number;
  worldPos: THREE.Vector3;
  size: number;
  aspect: number;
  macroNormalBias: THREE.Vector3;
  heightFraction: number;
  seed: number;
  rotation: number;
  opacity: number;
}

const GHIBLI_PUFF_VERT = /* glsl */ `
attribute vec3 aMacroBias;
attribute vec4 aPuffMeta; // x: heightFraction, y: seed, z: rotation, w: opacity

varying vec2 vUv;
varying vec3 vWorldCenter;
varying vec3 vMacroBias;
varying vec4 vPuffMeta;
varying float vViewDist;
varying vec3 vRightW;
varying vec3 vUpW;

uniform float uTime;
uniform vec2 uWindOffset;
uniform float uWeatherScale;

void main() {
  vUv = uv;
  vMacroBias = aMacroBias;
  vPuffMeta = aPuffMeta;

  vec4 centerWorld = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  centerWorld.xz += uWindOffset;
  vWorldCenter = centerWorld.xyz;

  // Extract puff width/height scale from instanceMatrix
  float sx = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2])) * uWeatherScale;
  float sy = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2])) * uWeatherScale;

  // Camera right & up vectors in world space for seamless volumetric billboarding
  vRightW = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vUpW = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

  // Subtle organic breathing rotation
  float rot = aPuffMeta.z + sin(uTime * 0.08 + aPuffMeta.y * 6.28) * 0.06;
  float c = cos(rot);
  float s = sin(rot);
  vec2 pRot = vec2(
    position.x * c - position.y * s,
    position.x * s + position.y * c
  );

  vec3 billWorld = centerWorld.xyz + vRightW * (pRot.x * sx) + vUpW * (pRot.y * sy);
  vec4 mvPos = viewMatrix * vec4(billWorld, 1.0);
  vViewDist = -mvPos.z;
  gl_Position = projectionMatrix * mvPos;
}
`;

const GHIBLI_PUFF_FRAG = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vWorldCenter;
varying vec3 vMacroBias;
varying vec4 vPuffMeta;
varying float vViewDist;
varying vec3 vRightW;
varying vec3 vUpW;

uniform sampler2D uPuffTex;
uniform vec3 uSunDir;
uniform vec3 uCloudBright;
uniform vec3 uCloudMid;
uniform vec3 uCloudShadow;
uniform vec3 uCloudRim;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uDrawDist;
uniform float uDensityMult;

float hgPhase(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(0.05, 1.0 + g2 - 2.0 * g * cosTheta), 1.5));
}

void main() {
  if (vViewDist > uDrawDist || vViewDist < 8.0) discard;

  // Sample baked painterly cauliflower cumulus map:
  // R = normal X (0..1), G = normal Y (0..1), B = sculpted billow thickness, A = crisp-yet-soft Ghibli alpha
  vec4 tex = texture2D(uPuffTex, vUv);
  float baseAlpha = tex.a;
  if (baseAlpha < 0.025) discard;

  // Smooth camera proximity fade when flying straight into a cloud puff (zero harsh clipping)
  float nearFade = smoothstep(14.0, 105.0, vViewDist);
  float farFade = 1.0 - smoothstep(uDrawDist * 0.72, uDrawDist, vViewDist);
  float alpha = clamp(baseAlpha * vPuffMeta.w * uDensityMult * nearFade * farFade, 0.0, 0.96);
  if (alpha < 0.015) discard;

  // Reconstruct 3D world-space volumetric puff normal
  vec3 V = normalize(cameraPosition - vWorldCenter);
  vec2 nXY = tex.rg * 2.0 - 1.0;
  float nZ = sqrt(max(0.04, 1.0 - dot(nXY, nXY)));
  vec3 localNormalW = normalize(vRightW * nXY.x + vUpW * nXY.y + V * nZ);

  // Blend micro puff normal with macro cloud-tower silhouette normal for cohesive sculpted castles!
  vec3 macroN = normalize(mix(localNormalW, normalize(vMacroBias + vec3(0.0, 0.28, 0.0)), 0.42));

  float sunDot = dot(macroN, uSunDir);
  float halfLambert = sunDot * 0.5 + 0.5;
  float heightLit = smoothstep(0.0, 0.92, vPuffMeta.x);
  float thickness = tex.b;

  // Sculpted Ghibli painterly shading: luminous warm sunlit crowns, soft periwinkle mid-folds, rich cerulean base
  float rawEnergy = clamp(
    halfLambert * 0.58 + heightLit * 0.34 + (thickness - 0.45) * 0.28 + (vUv.y - 0.35) * 0.14,
    0.0,
    1.15
  );

  // Gentle Ghibli painterly tonal steps blended smoothly with photoreal volumetric falloff
  float ghibliTone =
    smoothstep(0.18, 0.34, rawEnergy) * 0.44 +
    smoothstep(0.52, 0.70, rawEnergy) * 0.56;
  float lightEnergy = mix(rawEnergy, ghibliTone, 0.44);

  vec3 col = mix(uCloudShadow, uCloudMid, smoothstep(0.05, 0.48, lightEnergy));
  col = mix(col, uCloudBright, smoothstep(0.42, 0.86, lightEnergy));

  // Luminous silver-lining & Mie forward scattering along soft translucent edges
  float viewSunCos = dot(-V, uSunDir);
  float phase = clamp(hgPhase(viewSunCos, 0.62), 0.0, 2.0);
  float edgeTranslucent = (1.0 - thickness) * smoothstep(0.05, 0.65, baseAlpha);
  col += uCloudRim * edgeTranslucent * (0.16 + phase * 0.34) * (0.4 + 0.6 * heightLit);

  // Soft sky bounce in underside crevices so shadows feel airy, never muddy
  col += uSkyHorizon * (1.0 - lightEnergy) * 0.07;

  // Clean atmospheric perspective matching horizon & terrain
  float fogFactor = 1.0 - exp(-pow(vViewDist * uFogDensity * 0.8, 2.0));
  col = mix(col, mix(uFogColor, uSkyHorizon, 0.5), clamp(fogFactor, 0.0, 0.84));

  gl_FragColor = vec4(col, alpha);
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
uniform float uMistBoost;

void main() {
  vUv = uv;
  vec4 centerWorld = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  centerWorld.xz += uWindOffset * 1.15;

  float sx = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
  float sy = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));

  vec4 mvCenter = viewMatrix * centerWorld;
  vDist = -mvCenter.z;

  float rot = aRotation + uTime * 0.01;
  float c = cos(rot);
  float s = sin(rot);
  vec2 rotated = vec2(
    position.x * c - position.y * s,
    position.x * s + position.y * c
  );

  mvCenter.xy += rotated * vec2(sx, sy);

  float nearFade = smoothstep(10.0, 110.0, vDist);
  float farFade = 1.0 - smoothstep(3400.0, 6800.0, vDist);
  vAlpha = aOpacity * uMistBoost * nearFade * farFade;

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

void main() {
  if (vAlpha <= 0.004) discard;
  vec2 c = vUv * 2.0 - 1.0;
  float r = 1.0 - dot(c, c);
  if (r <= 0.0) discard;

  float alpha = pow(r, 2.0) * vAlpha;
  vec3 col = mix(uCloudMid, uCloudBright, 0.72 + 0.28 * vUv.y);
  float fog = 1.0 - exp(-pow(vDist * uFogDensity * 0.75, 2.0));
  col = mix(col, uFogColor, clamp(fog, 0.0, 0.85));

  gl_FragColor = vec4(col, alpha);
}
`;

export class CloudSystem {
  public readonly group = new THREE.Group();

  private clusters: CloudClusterDef[] = [];
  private puffs: PuffData[] = [];
  private puffMesh: THREE.InstancedMesh | null = null;
  private vaporMesh: THREE.InstancedMesh | null = null;
  private localMistGroup = new THREE.Group();
  private localMistSprites: THREE.Sprite[] = [];
  private localMistMat: THREE.SpriteMaterial;

  private puffTexture: THREE.DataTexture;
  private puffMaterial: THREE.ShaderMaterial;
  private vaporMaterial: THREE.ShaderMaterial;

  private baseWindVelocity = new THREE.Vector2(5.2, -2.2);
  private windStrength = 1.0;
  private windOffset = new THREE.Vector2(0, 0);
  private worldWrapSpan = 16000;

  private currentQuality: GraphicsConfig;
  private currentMode: GameplayModeId = 'free_flight';

  constructor(scene: THREE.Scene, quality: GraphicsConfig) {
    this.currentQuality = quality;
    this.puffTexture = this.generateGhibliCumulusPuffTexture(256);

    this.puffMaterial = new THREE.ShaderMaterial({
      vertexShader: GHIBLI_PUFF_VERT,
      fragmentShader: GHIBLI_PUFF_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uPuffTex: { value: this.puffTexture },
        uTime: { value: 0 },
        uWindOffset: { value: this.windOffset },
        uWeatherScale: { value: 1.0 },
        uDensityMult: { value: 1.0 },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, -0.5) },
        uCloudBright: { value: new THREE.Color('#ffffff') },
        uCloudMid: { value: new THREE.Color('#dce9f7') },
        uCloudShadow: { value: new THREE.Color('#5a7ba8') },
        uCloudRim: { value: new THREE.Color('#fffef7') },
        uSkyHorizon: { value: new THREE.Color('#7cb4e8') },
        uFogColor: { value: new THREE.Color('#86b9e8') },
        uFogDensity: { value: 0.00005 },
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
        uMistBoost: { value: 1.0 },
        uCloudBright: { value: new THREE.Color('#ffffff') },
        uCloudMid: { value: new THREE.Color('#dce9f7') },
        uFogColor: { value: new THREE.Color('#86b9e8') },
        uFogDensity: { value: 0.00005 },
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

  /**
   * Procedurally bakes a crisp, painterly Studio Ghibli multi-lobe cauliflower cumulus puff atlas:
   * R,G = sculpted 3D surface normal XY; B = volumetric optical thickness; A = fluffy feathered silhouette!
   */
  private generateGhibliCumulusPuffTexture(size: number): THREE.DataTexture {
    const data = new Uint8Array(size * size * 4);
    const heightField = new Float32Array(size * size);

    // 7 organic sub-lobes forming a classic sunlit Ghibli cumulus cauliflower silhouette
    const subLobes: Array<{ x: number; y: number; r: number; w: number }> = [
      { x: 0.0, y: 0.06, r: 0.56, w: 1.0 },     // Central crown
      { x: -0.34, y: -0.06, r: 0.42, w: 0.88 }, // Left billow
      { x: 0.36, y: -0.04, r: 0.44, w: 0.9 },   // Right billow
      { x: -0.18, y: 0.3, r: 0.36, w: 0.84 },   // Upper-left turret
      { x: 0.2, y: 0.28, r: 0.34, w: 0.82 },    // Upper-right turret
      { x: -0.22, y: -0.28, r: 0.36, w: 0.72 }, // Flat condensation base left
      { x: 0.22, y: -0.28, r: 0.36, w: 0.72 },  // Flat condensation base right
    ];

    for (let y = 0; y < size; y++) {
      const ny = (y / (size - 1)) * 2 - 1;
      for (let x = 0; x < size; x++) {
        const nx = (x / (size - 1)) * 2 - 1;

        let maxLobe = 0;
        let accumLobe = 0;
        for (const l of subLobes) {
          const dx = nx - l.x;
          const dy = ny - l.y;
          const d = Math.hypot(dx, dy) / l.r;
          if (d < 1.0) {
            const h = Math.sqrt(1.0 - d * d) * l.w;
            if (h > maxLobe) maxLobe = h;
            accumLobe += h * h;
          }
        }

        // Smooth union of lobes + crisp organic cumulus billow modulation
        const smoothH = Math.min(1.0, maxLobe * 0.72 + Math.sqrt(accumLobe) * 0.32);
        const billowNoise =
          noise3D(nx * 2.8 + 4.1, ny * 2.8 + 1.7, 2.3) * 0.55 +
          noise3D(nx * 6.2 - 3.3, ny * 6.2 + 5.1, 7.1) * 0.3 +
          noise3D(nx * 12.5 + 8.0, ny * 12.5 - 2.4, 1.2) * 0.15;

        // Slightly flatten underside like real cumulus condensation level
        const baseFlatten = ny < -0.25 ? clamp(1.0 - (-0.25 - ny) * 1.45, 0.0, 1.0) : 1.0;
        const radialGuard = smoothstep(0.98, 0.74, Math.hypot(nx, ny));
        const sculpted = clamp((smoothH + (billowNoise - 0.44) * 0.26) * baseFlatten * radialGuard, 0, 1);
        heightField[y * size + x] = sculpted;
      }
    }

    // Compute smooth surface normals from heightField via central differences
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        const h = heightField[idx];
        const xm = Math.max(0, x - 2);
        const xp = Math.min(size - 1, x + 2);
        const ym = Math.max(0, y - 2);
        const yp = Math.min(size - 1, y + 2);

        const dhdx = (heightField[y * size + xp] - heightField[y * size + xm]) * 3.4;
        const dhdy = (heightField[yp * size + x] - heightField[ym * size + x]) * 3.4;

        // Blend local gradient with gentle overall puff sphere normal
        const nx = (x / (size - 1)) * 2 - 1;
        const ny = (y / (size - 1)) * 2 - 1;
        let gx = -dhdx + nx * 0.52;
        let gy = -dhdy + ny * 0.52;
        const gz = 1.0;
        const invLen = 1.0 / Math.hypot(gx, gy, gz);
        gx *= invLen;
        gy *= invLen;

        // Crisp yet feathery painterly alpha edge
        const alpha = smoothstep(0.08, 0.42, h);

        data[idx * 4 + 0] = Math.round(clamp(gx * 0.5 + 0.5, 0, 1) * 255);
        data[idx * 4 + 1] = Math.round(clamp(gy * 0.5 + 0.5, 0, 1) * 255);
        data[idx * 4 + 2] = Math.round(clamp(h, 0, 1) * 255);
        data[idx * 4 + 3] = Math.round(clamp(alpha, 0, 1) * 255);
      }
    }

    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  private createSoftMistTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0.0, 'rgba(255,255,255,0.62)');
    grad.addColorStop(0.45, 'rgba(245,250,255,0.26)');
    grad.addColorStop(1.0, 'rgba(240,248,255,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  private generateMacroClusterLayout(): void {
    this.clusters = [];

    // 1. GRAND GHIBLI CUMULUS CANYON WALLS flanking the sunlit emerald valley
    const canyonSteps = 14;
    for (let i = 0; i < canyonSteps; i++) {
      const z = 520 - i * 480 + (hash2(i, 11) - 0.5) * 140;

      const leftDist = 520 + hash2(i, 21) * 320;
      const leftTowerH = 880 + hash2(i, 31) * 920 + (i % 3 === 1 ? 360 : 0);
      this.clusters.push({
        baseX: -leftDist,
        baseY: 360 + hash2(i, 41) * 110,
        baseZ: z,
        radius: 260 + hash2(i, 51) * 150,
        height: leftTowerH,
        kind: 'canyon_tower',
        extraExplorationOnly: false,
      });

      const rightDist = 510 + hash2(i, 61) * 320;
      const rightTowerH = 860 + hash2(i, 71) * 880 + (i % 2 === 0 ? 380 : 0);
      this.clusters.push({
        baseX: rightDist,
        baseY: 350 + hash2(i, 81) * 115,
        baseZ: z - 110,
        radius: 265 + hash2(i, 91) * 155,
        height: rightTowerH,
        kind: 'canyon_tower',
        extraExplorationOnly: false,
      });

      if (i % 2 === 0) {
        const side = i % 4 === 0 ? -1 : 1;
        this.clusters.push({
          baseX: side * (290 + hash2(i, 101) * 140),
          baseY: 290 + hash2(i, 111) * 85,
          baseZ: z - 180,
          radius: 150 + hash2(i, 121) * 70,
          height: 220 + hash2(i, 131) * 140,
          kind: 'scattered',
          extraExplorationOnly: false,
        });
      }
    }

    // 2. MONUMENTAL DISTANT CUMULONIMBUS CASTLES around the sea & mountain ring
    for (let i = 0; i < 38; i++) {
      const angle = (i / 38) * Math.PI * 2 + hash2(i, 201) * 0.14;
      const ringDist = 2400 + hash2(i, 211) * 6800;
      const x = Math.sin(angle) * ringDist;
      const z = -1500 + Math.cos(angle) * ringDist;
      if (Math.abs(x) < 680 && z > 650 && z < 3400) continue;

      this.clusters.push({
        baseX: x,
        baseY: 440 + hash2(i, 221) * 260,
        baseZ: z,
        radius: 360 + hash2(i, 231) * 260,
        height: 1050 + hash2(i, 241) * 1250,
        kind: 'castle',
        extraExplorationOnly: i > 26,
      });
    }

    // 3. SCATTERED FAIR-WEATHER CUMULUS & SEA-BREEZE CLOUD DECKS
    for (let i = 0; i < 40; i++) {
      const x = (hash2(i, 301) - 0.5) * 15500;
      const z = (hash2(i, 311) - 0.58) * 15500;
      if (Math.abs(x) < 420 && z > -5500 && z < 3400) continue;

      const isBlanket = i % 3 === 0;
      this.clusters.push({
        baseX: x,
        baseY: isBlanket ? 540 + hash2(i, 321) * 200 : 620 + hash2(i, 331) * 460,
        baseZ: z,
        radius: isBlanket ? 420 + hash2(i, 341) * 230 : 210 + hash2(i, 351) * 140,
        height: isBlanket ? 240 + hash2(i, 361) * 140 : 360 + hash2(i, 371) * 320,
        kind: isBlanket ? 'blanket' : 'scattered',
        extraExplorationOnly: i > 28,
      });
    }

    // 4. EXTRA CLOUD CATHEDRAL ARCHES FOR CLOUD EXPLORATION MODE
    for (let i = 0; i < 16; i++) {
      const z = -300 - i * 400;
      const x = Math.sin(i * 0.7) * 340;
      this.clusters.push({
        baseX: x,
        baseY: 740 + (i % 3) * 180,
        baseZ: z,
        radius: 240 + hash2(i, 401) * 120,
        height: 820 + hash2(i, 411) * 620,
        kind: 'castle',
        extraExplorationOnly: true,
      });
    }
  }

  public rebuildMeshes(): void {
    if (this.puffMesh) {
      this.group.remove(this.puffMesh);
      this.puffMesh.geometry.dispose();
      this.puffMesh = null;
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

    const puffs: PuffData[] = [];

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
        let puffSize = 200;
        let aspect = 1.15;

        if (c.kind === 'canyon_tower' || c.kind === 'castle') {
          const hCurve = Math.pow(frac, 0.86);
          oy = hCurve * c.height;
          const radialSpread = c.radius * (1.02 - hCurve * 0.54);
          const ang = r1 * Math.PI * 2 + frac * 4.4;
          const rad = radialSpread * (0.2 + 0.78 * Math.sqrt(r2));
          ox = Math.cos(ang) * rad;
          oz = Math.sin(ang) * rad;
          puffSize = c.radius * (1.28 - hCurve * 0.42) * (0.85 + 0.35 * r3);
          aspect = 1.18 - hCurve * 0.16;
        } else if (c.kind === 'blanket') {
          const ang = r1 * Math.PI * 2;
          const rad = c.radius * Math.sqrt(r2);
          ox = Math.cos(ang) * rad;
          oz = Math.sin(ang) * rad;
          oy = (r3 - 0.35) * c.height;
          puffSize = c.radius * (0.9 + 0.42 * r1);
          aspect = 1.48;
        } else {
          const ang = r1 * Math.PI * 2;
          const rad = c.radius * 0.72 * Math.sqrt(r2);
          ox = Math.cos(ang) * rad;
          oz = Math.sin(ang) * rad;
          oy = frac * c.height * 0.85;
          puffSize = c.radius * (1.15 - frac * 0.25) * (0.85 + 0.3 * r3);
          aspect = 1.25;
        }

        const macroBias = new THREE.Vector3(ox, oy - c.height * 0.34, oz);
        if (macroBias.lengthSq() < 0.001) macroBias.set(0, 1, 0);
        macroBias.normalize();

        puffs.push({
          clusterIndex: ci,
          worldPos: new THREE.Vector3(c.baseX + ox, c.baseY + oy, c.baseZ + oz),
          size: puffSize,
          aspect,
          macroNormalBias: macroBias,
          heightFraction: clamp(oy / Math.max(c.height, 1), 0, 1),
          seed: r1 * 10 + r2,
          rotation: (r3 - 0.5) * 0.65,
          opacity: 0.78 + 0.2 * (1.0 - Math.abs(frac - 0.5)),
        });
      }
    }

    // Sort lower puffs first so bright sunlit crowns layer cleanly on top
    puffs.sort((a, b) => a.worldPos.y - b.worldPos.y);
    this.puffs = puffs;

    const planeGeo = new THREE.PlaneGeometry(1, 1);
    const instMesh = new THREE.InstancedMesh(planeGeo, this.puffMaterial, puffs.length);
    instMesh.frustumCulled = false;
    instMesh.renderOrder = 8;

    const macroBiasArr = new Float32Array(puffs.length * 3);
    const metaArr = new Float32Array(puffs.length * 4);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      dummy.position.copy(p.worldPos);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(p.size * p.aspect, p.size, 1);
      dummy.updateMatrix();
      instMesh.setMatrixAt(i, dummy.matrix);

      macroBiasArr[i * 3 + 0] = p.macroNormalBias.x;
      macroBiasArr[i * 3 + 1] = p.macroNormalBias.y;
      macroBiasArr[i * 3 + 2] = p.macroNormalBias.z;

      metaArr[i * 4 + 0] = p.heightFraction;
      metaArr[i * 4 + 1] = p.seed;
      metaArr[i * 4 + 2] = p.rotation;
      metaArr[i * 4 + 3] = p.opacity;
    }

    planeGeo.setAttribute('aMacroBias', new THREE.InstancedBufferAttribute(macroBiasArr, 3));
    planeGeo.setAttribute('aPuffMeta', new THREE.InstancedBufferAttribute(metaArr, 4));
    instMesh.instanceMatrix.needsUpdate = true;

    this.puffMesh = instMesh;
    this.group.add(instMesh);

    // Gossamer valley mist wisps
    const wispCount = this.currentQuality.mistParticles * 2;
    const wispGeo = new THREE.PlaneGeometry(1, 1);
    const vaporInst = new THREE.InstancedMesh(wispGeo, this.vaporMaterial, wispCount);
    vaporInst.frustumCulled = false;
    vaporInst.renderOrder = 14;

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

      if (i < wispCount * 0.5) {
        wx = (r1 - 0.5) * 1050;
        wy = 340 + r2 * 520;
        wz = 350 - (i / (wispCount * 0.5)) * 6200 + (r3 - 0.5) * 260;
        wScale = 230 + r3 * 290;
        opacity = 0.14 + r2 * 0.12;
      } else {
        wx = (r1 - 0.5) * 7800;
        wy = 85 + r2 * 140;
        wz = (r3 - 0.55) * 9000;
        wScale = 440 + r1 * 480;
        opacity = 0.12 + r3 * 0.12;
      }

      dummy.position.set(wx, wy, wz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(wScale * 1.45, wScale * 0.78, 1);
      dummy.updateMatrix();
      vaporInst.setMatrixAt(i, dummy.matrix);

      rotArr[i] = r1 * Math.PI * 2;
      opArr[i] = opacity;
    }

    wispGeo.setAttribute('aRotation', new THREE.InstancedBufferAttribute(rotArr, 1));
    wispGeo.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(opArr, 1));
    vaporInst.instanceMatrix.needsUpdate = true;

    this.vaporMesh = vaporInst;
    this.group.add(vaporInst);
  }

  private buildLocalFlyThroughMist(): void {
    for (let i = 0; i < 16; i++) {
      const sp = new THREE.Sprite(this.localMistMat);
      const ang = (i / 16) * Math.PI * 2;
      const dist = 16 + (i % 3) * 14;
      sp.position.set(
        Math.cos(ang) * dist,
        ((i % 5) - 2) * 5.2,
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

  public applyWeather(weather: WeatherConfig): void {
    this.windStrength = weather.windStrength;
    this.puffMaterial.uniforms.uDensityMult.value = clamp(weather.cloudDensityMult, 0.45, 1.35);
    this.puffMaterial.uniforms.uWeatherScale.value = 0.88 + weather.cloudDensityMult * 0.16;
    this.vaporMaterial.uniforms.uMistBoost.value =
      weather.id === 'misty_valley' ? 2.1 : weather.id === 'clear' ? 0.35 : 1.0;
  }

  public applyPreset(preset: AtmospherePreset, sunDir: THREE.Vector3): void {
    const u = this.puffMaterial.uniforms;
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
    this.puffMaterial.uniforms.uDrawDist.value = quality.drawDistance;
    if (needsRebuild) {
      this.rebuildMeshes();
    }
  }

  public getCloudDensityAt(worldPos: THREE.Vector3): number {
    let maxD = 0;
    const px = worldPos.x - this.windOffset.x;
    const py = worldPos.y;
    const pz = worldPos.z - this.windOffset.y;

    const limit = Math.min(this.clusters.length, this.currentQuality.cloudClusterCount);
    for (let i = 0; i < limit; i++) {
      const c = this.clusters[i];
      if (c.extraExplorationOnly && this.currentMode !== 'cloud_exploration') continue;

      const minY = c.baseY - c.radius * 0.5;
      const maxY = c.baseY + c.height + c.radius * 0.5;
      if (py < minY || py > maxY) continue;

      const dx = px - c.baseX;
      const dz = pz - c.baseZ;
      const horizR = c.radius * 1.15;
      const d2 = dx * dx + dz * dz;
      if (d2 > horizR * horizR) continue;

      const hFrac = clamp((py - c.baseY) / Math.max(c.height, 1), 0, 1);
      const effectiveR = c.radius * (c.kind === 'blanket' ? 1.1 : 1.08 - hFrac * 0.42);
      const horizDist = Math.sqrt(d2);
      if (horizDist > effectiveR) continue;

      const radialFactor = 1.0 - horizDist / effectiveR;
      const vertFactor = smoothstep(minY, minY + 95, py) * smoothstep(maxY, maxY - 120, py);
      const n = 0.65 + 0.35 * noise3D(px * 0.008, py * 0.008, pz * 0.008);
      const d = clamp(radialFactor * vertFactor * n * 1.5, 0, 1);
      if (d > maxD) maxD = d;
      if (maxD > 0.92) break;
    }

    return maxD;
  }

  public update(dt: number, elapsed: number, aircraftPos: THREE.Vector3, cloudDensity: number): void {
    this.windOffset.x += this.baseWindVelocity.x * this.windStrength * dt;
    this.windOffset.y += this.baseWindVelocity.y * this.windStrength * dt;
    if (this.windOffset.length() > this.worldWrapSpan) {
      this.windOffset.multiplyScalar(0.01);
    }

    this.puffMaterial.uniforms.uTime.value = elapsed;
    this.vaporMaterial.uniforms.uTime.value = elapsed;

    this.localMistGroup.position.copy(aircraftPos);
    const targetOpacity = clamp(cloudDensity * 0.42, 0, 0.42);
    this.localMistMat.opacity += (targetOpacity - this.localMistMat.opacity) * Math.min(1, dt * 4.0);
    this.localMistGroup.visible = this.localMistMat.opacity > 0.01;

    if (this.localMistGroup.visible) {
      for (let i = 0; i < this.localMistSprites.length; i++) {
        const sp = this.localMistSprites[i];
        sp.material.rotation = elapsed * 0.14 + i;
      }
    }
  }

  public getPuffCount(): number {
    return this.puffs.length;
  }
}
