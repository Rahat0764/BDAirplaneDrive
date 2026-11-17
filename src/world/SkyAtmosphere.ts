import * as THREE from 'three';
import { AtmospherePreset, GraphicsConfig } from '../types';

const SKY_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldDir;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldDir = position;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec3 vWorldDir;

uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uMoonVis;
uniform float uStarVis;
uniform vec3 uSkyZenith;
uniform vec3 uSkyUpper;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
uniform vec3 uSunColor;
uniform vec3 uCloudBright;
uniform vec3 uCloudMid;
uniform vec3 uCloudShadow;
uniform vec3 uCloudRim;
uniform float uTime;
uniform int uSteps;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm2(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 5; i++) {
    v += a * noise2(p);
    p = rot * p * 2.04 + vec2(17.1, 31.7);
    a *= 0.5;
  }
  return v;
}

// Billowy cumulus noise for distant horizon cloud sea
float billowFbm(vec2 p) {
  float v = 0.0;
  float a = 0.52;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 5; i++) {
    float n = noise2(p);
    float b = 1.0 - abs(n * 2.0 - 1.0);
    v += a * mix(n, b * b, 0.65);
    p = rot * p * 2.08 + vec2(9.2, 14.5);
    a *= 0.49;
  }
  return v;
}

float hgPhase(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(0.02, 1.0 + g2 - 2.0 * g * cosTheta), 1.5));
}

void main() {
  vec3 dir = normalize(vWorldDir);
  float elev = dir.y;

  // Atmospheric sky gradient with Rayleigh/Mie scattering feel
  float upT = clamp(elev, 0.0, 1.0);
  vec3 sky = mix(uSkyHorizon, uSkyUpper, pow(upT, 0.48));
  sky = mix(sky, uSkyZenith, pow(upT, 1.25));

  if (elev < 0.0) {
    sky = mix(uSkyHorizon, uSkyGround, clamp(-elev * 3.2, 0.0, 1.0));
  }

  // Sun scattering & warm Mie glow
  float sunMu = dot(dir, uSunDir);
  float mieGlow = pow(max(sunMu, 0.0), 8.0) * 0.28 + pow(max(sunMu, 0.0), 96.0) * 0.55;
  float horizonGlow = exp(-abs(elev) * 6.5) * pow(max(sunMu * 0.5 + 0.5, 0.0), 2.5) * 0.22;
  sky += uSunColor * (mieGlow + horizonGlow);

  // Subtle starfield in twilight / blue hour
  if (uStarVis > 0.01 && elev > 0.03) {
    vec3 starCell = floor(dir * 340.0);
    float rnd = hash13(starCell);
    if (rnd > 0.9955) {
      float twinkle = 0.7 + 0.3 * sin(uTime * 2.3 + rnd * 90.0);
      float starBright = smoothstep(0.9955, 1.0, rnd) * twinkle * uStarVis * smoothstep(0.03, 0.28, elev);
      sky += vec3(0.88, 0.93, 1.0) * starBright * 1.35;
    }
  }

  // Crisp photorealistic Moon disc with Maria & crater detail (inspired by ref.mp4!)
  if (uMoonVis > 0.01) {
    float moonCos = dot(dir, uMoonDir);
    float moonRadiusCos = cos(0.047); // Majestic cinematic apparent scale (~2.7 deg radius)
    // Soft atmospheric lunar halo
    float moonHalo = pow(max(moonCos, 0.0), 140.0) * 0.24 * uMoonVis;
    sky += vec3(0.86, 0.91, 1.0) * moonHalo;

    if (moonCos > moonRadiusCos - 0.0006) {
      vec3 moonRight = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
      vec3 moonUp = cross(uMoonDir, moonRight);
      vec2 mUv = vec2(dot(dir, moonRight), dot(dir, moonUp)) / sin(0.047);
      float r2 = dot(mUv, mUv);
      if (r2 < 1.0) {
        float z = sqrt(max(0.0, 1.0 - r2));
        vec3 mNormal = normalize(vec3(mUv.x, mUv.y, z));
        // Lunar Maria (dark basalt plains) + highland craters
        float maria = fbm2(mUv * 2.3 + vec2(3.7, 1.4));
        float craters = fbm2(mUv * 9.5 - vec2(4.2, 6.1));
        float micro = noise2(mUv * 24.0 + 2.0);
        float mariaMask = smoothstep(0.45, 0.66, maria);
        vec3 highlandCol = vec3(0.98, 0.965, 0.91);
        vec3 mariaCol = vec3(0.74, 0.755, 0.76);
        vec3 moonSurf = mix(highlandCol, mariaCol, mariaMask * 0.78);
        moonSurf *= 0.90 + 0.14 * craters + 0.05 * micro;
        // Subtle spherical limb darkening + gentle sun phase shading
        float limb = pow(z, 0.26);
        float diskEdge = smoothstep(1.0, 0.955, sqrt(r2));
        vec3 moonFinal = moonSurf * (0.86 + 0.20 * limb);
        // Blend realistically against daytime blue sky (screen/additive luminance like real daytime moon!)
        vec3 daytimeBlend = max(sky, mix(sky, moonFinal, 0.88 * uMoonVis));
        sky = mix(sky, daytimeBlend, diskEdge);
      }
    }
  }

  // Sun disc (when above horizon and not Blue Hour moon-keyed)
  if (uStarVis < 0.65) {
    float sunDisc = smoothstep(0.9992, 0.99975, sunMu);
    sky += uSunColor * sunDisc * 2.8;
  }

  // High-altitude wispy cirrus clouds overhead
  if (elev > 0.02) {
    vec2 cirrusUv = dir.xz / (elev + 0.14) * 0.85 + vec2(uTime * 0.0022, -uTime * 0.0012);
    float c1 = fbm2(cirrusUv * 1.8);
    float c2 = fbm2(cirrusUv * 4.2 + vec2(c1 * 1.4));
    float cirrus = smoothstep(0.56, 0.86, c1 * 0.65 + c2 * 0.35) * smoothstep(0.02, 0.22, elev) * smoothstep(0.95, 0.25, elev);
    vec3 cirrusCol = mix(uCloudMid, uCloudBright, 0.78);
    sky = mix(sky, cirrusCol, cirrus * 0.36);
  }

  // Ray-sculpted distant volumetric horizon cumulus sea (stretching endlessly like ref.mp4!)
  if (elev > -0.04 && elev < 0.36) {
    float projY = max(elev + 0.045, 0.028);
    vec2 baseUv = dir.xz / projY * 0.42 + vec2(uTime * 0.0016, uTime * 0.0009);

    float accumAlpha = 0.0;
    vec3 accumColor = vec3(0.0);
    int steps = clamp(uSteps, 6, 20);
    float invSteps = 1.0 / float(steps);

    float phase = clamp(hgPhase(sunMu, 0.55) * 0.45 + 0.55, 0.45, 1.45);

    for (int i = 0; i < 20; i++) {
      if (i >= steps) break;
      float hFrac = (float(i) + 0.5) * invSteps; // 0 = base, 1 = tall crown
      vec2 sampleUv = baseUv * (1.0 - hFrac * 0.16) + vec2(hFrac * 0.08, -hFrac * 0.05);
      float densityNoise = billowFbm(sampleUv * 2.1);

      // Shape towering cumulus silhouettes near horizon
      float bandMask = smoothstep(0.36, 0.02, elev - hFrac * 0.16) * smoothstep(-0.04, 0.035, elev);
      float heightProfile = sin(hFrac * 3.14159265);
      float d = smoothstep(0.50, 0.80, densityNoise) * bandMask * (0.55 + 0.65 * heightProfile);

      if (d > 0.005) {
        // Light sample toward sun direction for self-shadowed billow folds
        vec2 sunStepUv = sampleUv + uSunDir.xz * 0.09;
        float occ = billowFbm(sunStepUv * 2.1);
        float lit = clamp((densityNoise - occ * 0.82) * 2.4 + hFrac * 0.72, 0.0, 1.0);

        vec3 cCol = mix(uCloudShadow, uCloudMid, smoothstep(0.0, 0.48, lit));
        cCol = mix(cCol, uCloudBright, smoothstep(0.38, 0.88, lit));
        cCol += uCloudRim * pow(lit, 3.0) * (phase - 0.45) * 0.35;

        // Aerial perspective blend into horizon sky
        float distFade = smoothstep(0.34, 0.01, elev);
        cCol = mix(cCol, mix(cCol, uSkyHorizon, 0.38), distFade * 0.55);

        float stepAlpha = d * 0.24;
        accumColor += (1.0 - accumAlpha) * stepAlpha * cCol;
        accumAlpha += (1.0 - accumAlpha) * stepAlpha;
        if (accumAlpha > 0.94) break;
      }
    }

    sky = sky * (1.0 - accumAlpha) + accumColor;
  }

  gl_FragColor = vec4(sky, 1.0);
}
`;

export class SkyAtmosphere {
  public readonly skyMesh: THREE.Mesh;
  public readonly sunLight: THREE.DirectionalLight;
  public readonly hemiLight: THREE.HemisphereLight;
  public readonly sunDirection = new THREE.Vector3();
  public readonly moonDirection = new THREE.Vector3();

  private material: THREE.ShaderMaterial;
  private pmremGenerator: THREE.PMREMGenerator;
  private envScene: THREE.Scene;
  private envSkyMesh: THREE.Mesh;
  private currentEnvRT: THREE.WebGLRenderTarget | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, quality: GraphicsConfig) {
    this.pmremGenerator = new THREE.PMREMGenerator(renderer);
    this.pmremGenerator.compileEquirectangularShader();

    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0.5, 0.7, -0.5) },
        uMoonDir: { value: new THREE.Vector3(0.35, 0.45, -0.82) },
        uMoonVis: { value: 0.96 },
        uStarVis: { value: 0.0 },
        uSkyZenith: { value: new THREE.Color('#0c2f6b') },
        uSkyUpper: { value: new THREE.Color('#1c57a3') },
        uSkyHorizon: { value: new THREE.Color('#7cb4e8') },
        uSkyGround: { value: new THREE.Color('#4b6d58') },
        uSunColor: { value: new THREE.Color('#fff9ed') },
        uCloudBright: { value: new THREE.Color('#ffffff') },
        uCloudMid: { value: new THREE.Color('#dce9f7') },
        uCloudShadow: { value: new THREE.Color('#5a7ba8') },
        uCloudRim: { value: new THREE.Color('#fffef7') },
        uTime: { value: 0 },
        uSteps: { value: quality.skyRaymarchSteps },
      },
    });

    const skyGeo = new THREE.SphereGeometry(28000, 48, 32);
    this.skyMesh = new THREE.Mesh(skyGeo, this.material);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1000;
    scene.add(this.skyMesh);

    // Environment bake mini-scene for realistic PBR aircraft & ocean reflections
    this.envScene = new THREE.Scene();
    this.envSkyMesh = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 20), this.material);
    this.envScene.add(this.envSkyMesh);

    // Primary Directional Sun/Moon Light with crisp Ghibli-clean shadow frustum
    this.sunLight = new THREE.DirectionalLight(0xfffaf0, 3.1);
    this.sunLight.castShadow = quality.shadowsEnabled;
    this.sunLight.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.sunLight.shadow.camera.near = 8;
    this.sunLight.shadow.camera.far = 1600;
    const d = 230;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.00032;
    this.sunLight.shadow.normalBias = 0.022;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.hemiLight = new THREE.HemisphereLight(0x6ba6e8, 0x3b563c, 1.05);
    scene.add(this.hemiLight);
  }

  private sphericalToDir(elevDeg: number, azimDeg: number, out: THREE.Vector3): THREE.Vector3 {
    const elev = THREE.MathUtils.degToRad(elevDeg);
    const azim = THREE.MathUtils.degToRad(azimDeg);
    // Azimuth 0 = -Z (north / straight down the Grand Cloud Canyon!)
    const cosE = Math.cos(elev);
    out.set(Math.sin(azim) * cosE, Math.sin(elev), -Math.cos(azim) * cosE).normalize();
    return out;
  }

  public applyPreset(preset: AtmospherePreset, scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
    this.sphericalToDir(preset.sunElevationDeg, preset.sunAzimuthDeg, this.sunDirection);
    this.sphericalToDir(preset.moonElevationDeg, preset.moonAzimuthDeg, this.moonDirection);

    const u = this.material.uniforms;
    u.uSunDir.value.copy(this.sunDirection);
    u.uMoonDir.value.copy(this.moonDirection);
    u.uMoonVis.value = preset.moonVisibility;
    u.uStarVis.value = preset.starVisibility;
    u.uSkyZenith.value.copy(preset.skyZenith);
    u.uSkyUpper.value.copy(preset.skyUpper);
    u.uSkyHorizon.value.copy(preset.skyHorizon);
    u.uSkyGround.value.copy(preset.skyGroundBounce);
    u.uSunColor.value.copy(preset.sunColor);
    u.uCloudBright.value.copy(preset.cloudBrightColor);
    u.uCloudMid.value.copy(preset.cloudMidColor);
    u.uCloudShadow.value.copy(preset.cloudShadowColor);
    u.uCloudRim.value.copy(preset.cloudRimColor);

    this.sunLight.color.copy(preset.sunColor);
    this.sunLight.intensity = preset.sunIntensity;

    this.hemiLight.color.copy(preset.hemiSkyColor);
    this.hemiLight.groundColor.copy(preset.hemiGroundColor);
    this.hemiLight.intensity = preset.hemiIntensity;

    scene.fog = new THREE.FogExp2(preset.fogColor.getHex(), preset.fogDensity);
    renderer.toneMappingExposure = preset.exposure;

    // Regenerate PBR environment cubemap from our atmospheric sky dome!
    if (this.currentEnvRT) {
      this.currentEnvRT.dispose();
    }
    this.currentEnvRT = this.pmremGenerator.fromScene(this.envScene, 0.035, 0.1, 200);
    scene.environment = this.currentEnvRT.texture;
  }

  public applyGraphicsQuality(quality: GraphicsConfig): void {
    this.material.uniforms.uSteps.value = quality.skyRaymarchSteps;
    this.sunLight.castShadow = quality.shadowsEnabled;
    if (
      this.sunLight.shadow.mapSize.width !== quality.shadowMapSize &&
      quality.shadowsEnabled
    ) {
      this.sunLight.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    }
  }

  public update(elapsed: number, focusPos: THREE.Vector3): void {
    this.material.uniforms.uTime.value = elapsed;
    this.skyMesh.position.copy(focusPos);

    this.sunLight.target.position.copy(focusPos);
    this.sunLight.position.copy(focusPos).addScaledVector(this.sunDirection, 450);
  }

  public dispose(): void {
    this.skyMesh.geometry.dispose();
    this.envSkyMesh.geometry.dispose();
    this.material.dispose();
    if (this.currentEnvRT) this.currentEnvRT.dispose();
    this.pmremGenerator.dispose();
  }
}
