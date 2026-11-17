import * as THREE from 'three';
import { AtmospherePreset, GraphicsConfig } from '../types';
import { clamp, fbm2D, hash2, noise2D, ridged2D, smoothstep } from '../utils/noise';

export interface AirportInfo {
  runwayCenter: THREE.Vector3;
  runwayLength: number;
  runwayWidth: number;
  elevation: number;
  thresholdSouth: THREE.Vector3;
  thresholdNorth: THREE.Vector3;
  islandRunwayCenter: THREE.Vector3;
}

export class TerrainSystem {
  public readonly group = new THREE.Group();
  public readonly airport: AirportInfo = {
    runwayCenter: new THREE.Vector3(0, 28.0, 1620),
    runwayLength: 980,
    runwayWidth: 34,
    elevation: 28.0,
    thresholdSouth: new THREE.Vector3(0, 28.0, 2060),
    thresholdNorth: new THREE.Vector3(0, 28.0, 1180),
    islandRunwayCenter: new THREE.Vector3(-3350, 18.0, -4850),
  };

  private terrainMesh: THREE.Mesh | null = null;
  private outerSkirtMesh: THREE.Mesh;
  private oceanMesh: THREE.Mesh;
  private riverMesh!: THREE.Mesh;
  private lakeMesh!: THREE.Mesh;
  private highwayGroup = new THREE.Group();
  private airportGroup = new THREE.Group();
  private propsGroup = new THREE.Group();

  private treeTrunksMesh: THREE.InstancedMesh | null = null;
  private pineCanopyMesh: THREE.InstancedMesh | null = null;
  private lushCanopyMesh: THREE.InstancedMesh | null = null;
  private settlementWallsMesh: THREE.InstancedMesh | null = null;
  private settlementRoofsMesh: THREE.InstancedMesh | null = null;

  private windmillRotors: THREE.Group[] = [];
  private birdFlockGroup = new THREE.Group();

  private terrainMat: THREE.MeshStandardMaterial;
  private waterMat: THREE.ShaderMaterial;
  private settlementWallMat: THREE.MeshStandardMaterial;
  private runwayLightMat: THREE.MeshBasicMaterial;
  private highwayLampMat: THREE.MeshBasicMaterial;
  private beaconLightObj: THREE.PointLight;

  private shaderUniforms = {
    uTime: { value: 0 },
    uCloudDrift: { value: new THREE.Vector2(0, 0) },
    uNightLights: { value: 0 },
    uShadowTint: { value: new THREE.Color('#5a80b8') },
  };

  private currentQuality: GraphicsConfig;
  private readonly terrainSize = 22000;

  constructor(scene: THREE.Scene, quality: GraphicsConfig) {
    this.currentQuality = quality;

    this.terrainMat = this.createTerrainMaterial();
    this.waterMat = this.createWaterMaterial();

    this.settlementWallMat = new THREE.MeshStandardMaterial({
      color: 0xf6f1e7,
      roughness: 0.75,
      metalness: 0.04,
      emissive: new THREE.Color(0xffbe6b),
      emissiveIntensity: 0.0,
    });

    this.runwayLightMat = new THREE.MeshBasicMaterial({ color: 0xfff3d1 });
    this.highwayLampMat = new THREE.MeshBasicMaterial({ color: 0xffe4a8 });

    // Expansive Sparkling Ocean Plane
    const oceanGeo = new THREE.PlaneGeometry(64000, 64000, 96, 96);
    oceanGeo.rotateX(-Math.PI / 2);
    this.oceanMesh = new THREE.Mesh(oceanGeo, this.waterMat);
    this.oceanMesh.position.y = 0.0;
    this.group.add(this.oceanMesh);

    // Distant horizon ocean bed skirt
    const outerGeo = new THREE.RingGeometry(10800, 31000, 64, 4);
    outerGeo.rotateX(-Math.PI / 2);
    this.outerSkirtMesh = new THREE.Mesh(
      outerGeo,
      new THREE.MeshStandardMaterial({ color: 0x1c4b6e, roughness: 0.9 })
    );
    this.outerSkirtMesh.position.y = -3.0;
    this.group.add(this.outerSkirtMesh);

    this.beaconLightObj = new THREE.PointLight(0x88ffaa, 0, 320);

    this.buildFlowingRiverAndLake();
    this.buildLandableHighwayAndBridge();
    this.buildAirports();
    this.buildWindmillsSailboatsAndBirds();

    this.group.add(this.highwayGroup);
    this.group.add(this.airportGroup);
    this.group.add(this.propsGroup);
    this.group.add(this.birdFlockGroup);

    this.rebuildTerrainAndScenery();
    scene.add(this.group);
  }

  public riverCenterX(z: number): number {
    return -230 + Math.sin(z * 0.00082) * 210 + Math.cos(z * 0.00036 + 0.8) * 125;
  }

  public riverSurfaceY(z: number): number {
    // Smoothly slopes from 18m in the upper south valley down to 12.5m at the alpine lake, then 0m into the bay!
    if (z < -5150) {
      return 12.5 * (1.0 - smoothstep(-5150, -6450, z));
    }
    return 12.5 + smoothstep(-4500, 2400, z) * 6.0;
  }

  /**
   * Landable Grand Valley Scenic Highway centerline (z from +2500 down to -4900 — 7.4 km long!)
   */
  public highwayCenterX(z: number): number {
    return 245 + Math.sin(z * 0.00052 + 1.1) * 145;
  }

  public highwayElevation(z: number): number {
    // Smooth, gentle aviation-grade landable profile (~29m..35m) so planes can land anywhere along it!
    return 31.0 + Math.sin(z * 0.00045) * 3.5;
  }

  public classifySurface(x: number, z: number): 'runway' | 'highway' | 'water' | 'terrain' {
    // Main Airport Runway 36/18
    if (
      Math.abs(x - this.airport.runwayCenter.x) <= this.airport.runwayWidth * 0.6 &&
      Math.abs(z - this.airport.runwayCenter.z) <= this.airport.runwayLength * 0.52
    ) {
      return 'runway';
    }
    // Coastal Island Airstrip
    if (
      Math.abs(x - this.airport.islandRunwayCenter.x) <= 16 &&
      Math.abs(z - this.airport.islandRunwayCenter.z) <= 350
    ) {
      return 'runway';
    }
    // Landable Grand Valley Scenic Highway (18m wide asphalt!)
    if (z > -4900 && z < 2500 && Math.abs(x - this.highwayCenterX(z)) <= 10.5) {
      return 'highway';
    }
    // Cross-valley River Bridge Deck at z = -1220 (x from -460 to +380)
    if (Math.abs(z + 1220) <= 9.0 && x >= -460 && x <= 380) {
      return 'highway';
    }
    const groundY = this.getTerrainHeight(x, z);
    const waterY = this.getWaterSurfaceHeight(x, z);
    if (waterY !== null && groundY <= waterY + 0.25) {
      return 'water';
    }
    return 'terrain';
  }

  public getWaterSurfaceHeight(x: number, z: number): number | null {
    // River channel
    if (z > -6500 && z < 2350 && Math.abs(x - this.riverCenterX(z)) < 36) {
      return this.riverSurfaceY(z);
    }
    // Alpine Mirror Lake
    const lakeDist = Math.hypot((x + 260) * 0.85, (z + 4750) * 0.65);
    if (lakeDist < 460) {
      return 12.5;
    }
    // Sea level ocean
    if (this.getRawLandHeight(x, z) < 0.2) {
      return 0.0;
    }
    return null;
  }

  private getRawLandHeight(x: number, z: number): number {
    const distFromOrigin = Math.hypot(x, z + 1200);
    const coastFade = 1.0 - smoothstep(7400, 10600, distFromOrigin);
    const bayMask = smoothstep(-2350, -4700, x) + smoothstep(-5850, -8200, z);

    const absX = Math.abs(x);
    const valleyMask = 1.0 - smoothstep(620, 2450, absX);

    const gentleRolling = fbm2D(x * 0.00044 + 3.1, z * 0.00044 - 1.7, 4) * 44 + 31;

    const mtnRidges = ridged2D(x * 0.00032 + 1.2, z * 0.00032 + 4.5, 5);
    const mtnDetail = fbm2D(x * 0.0012, z * 0.0012, 3) * 85;
    const eastBoost = smoothstep(950, 4200, x) * 1.18 + smoothstep(900, 3900, -x) * 0.78;
    const mountainHeight = (mtnRidges * 1120 + mtnDetail) * eastBoost;

    let h = gentleRolling * (0.48 + 0.52 * valleyMask) + mountainHeight * (1.0 - valleyMask * 0.88);

    if (bayMask > 0.001) {
      const islandNoise = ridged2D(x * 0.00065 - 7.3, z * 0.00065 + 2.1, 4);
      const islandH = (islandNoise - 0.41) * 330;
      h = THREE.MathUtils.lerp(h, islandH, clamp(bayMask, 0, 1));
    }

    return h * coastFade - (1.0 - coastFade) * 28.0;
  }

  /**
   * Exact continuous world height at any (x, z) coordinate in meters,
   * including flat grading for both airports, the 7.4 km Landable Scenic Highway, and the River Bridge!
   */
  public getTerrainHeight(x: number, z: number): number {
    let h = this.getRawLandHeight(x, z);

    // 1. Carve flowing valley river bed cleanly below riverSurfaceY(z)
    if (z > -6600 && z < 2450) {
      const rx = this.riverCenterX(z);
      const rDist = Math.abs(x - rx);
      if (rDist < 95) {
        const bedTarget = this.riverSurfaceY(z) - 4.2;
        const riverBlend = 1.0 - smoothstep(26, 95, rDist);
        h = THREE.MathUtils.lerp(h, Math.min(h, bedTarget), riverBlend);
      }
    }

    // 2. Carve Alpine Mirror Lake basin below 12.5m
    const lakeDist = Math.hypot((x + 260) * 0.85, (z + 4750) * 0.65);
    if (lakeDist < 540) {
      const lakeBlend = 1.0 - smoothstep(320, 540, lakeDist);
      h = THREE.MathUtils.lerp(h, 6.5, lakeBlend);
    }

    // 3. Grade LANDABLE GRAND VALLEY SCENIC HIGHWAY (flat 22m wide roadbed!)
    if (z > -4950 && z < 2550) {
      const hx = this.highwayCenterX(z);
      const hDist = Math.abs(x - hx);
      if (hDist < 58) {
        const endFade = smoothstep(-4950, -4750, z) * smoothstep(2550, 2350, z);
        const roadBlend = (1.0 - smoothstep(13, 56, hDist)) * endFade;
        h = THREE.MathUtils.lerp(h, this.highwayElevation(z), roadBlend);
      }
    }

    // 4. Support Cross-Valley River Bridge Deck at z = -1220 so planes can even land/roll across the bridge!
    if (Math.abs(z + 1220) <= 10.0 && x >= -465 && x <= 385) {
      return Math.max(h, 31.4);
    }

    // 5. Grade Dream Valley Airport Plateau (Runway 36/18)
    const dxAir = Math.abs(x - this.airport.runwayCenter.x);
    const dzAir = Math.abs(z - this.airport.runwayCenter.z);
    const airFlatten = (1.0 - smoothstep(118, 360, dxAir)) * (1.0 - smoothstep(560, 920, dzAir));
    if (airFlatten > 0.001) {
      h = THREE.MathUtils.lerp(h, this.airport.elevation, airFlatten);
    }

    // 6. Grade Azure Island Coastal Airstrip Plateau (-3350, -4850, y = 18.0m)
    const dxIsl = Math.abs(x - this.airport.islandRunwayCenter.x);
    const dzIsl = Math.abs(z - this.airport.islandRunwayCenter.z);
    const islFlatten = (1.0 - smoothstep(65, 240, dxIsl)) * (1.0 - smoothstep(390, 680, dzIsl));
    if (islFlatten > 0.001) {
      h = THREE.MathUtils.lerp(h, this.airport.islandRunwayCenter.y, islFlatten);
    }

    return h;
  }

  private createTerrainMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.84,
      metalness: 0.02,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.shaderUniforms.uTime;
      shader.uniforms.uCloudDrift = this.shaderUniforms.uCloudDrift;
      shader.uniforms.uShadowTint = this.shaderUniforms.uShadowTint;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vTerrainWorldPos;
          varying vec3 vTerrainNormalW;
          `
        )
        .replace(
          '#include <worldpos_vertex>',
          /* glsl */ `
          #include <worldpos_vertex>
          vec4 terrainWP = modelMatrix * vec4(transformed, 1.0);
          vTerrainWorldPos = terrainWP.xyz;
          vTerrainNormalW = normalize(mat3(modelMatrix) * objectNormal);
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vTerrainWorldPos;
          varying vec3 vTerrainNormalW;
          uniform float uTime;
          uniform vec2 uCloudDrift;
          uniform vec3 uShadowTint;

          float thash(vec2 p) {
            vec3 p3 = fract(vec3(p.xyx) * 0.1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
          }

          float tnoise(vec2 x) {
            vec2 i = floor(x);
            vec2 f = fract(x);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(thash(i), thash(i + vec2(1.0, 0.0)), f.x),
              mix(thash(i + vec2(0.0, 1.0)), thash(i + vec2(1.0, 1.0)), f.x),
              f.y
            );
          }

          float tfbm(vec2 p) {
            float s = 0.0;
            float a = 0.5;
            for (int i = 0; i < 4; i++) {
              s += a * tnoise(p);
              p = p * 2.05 + vec2(11.3, 7.9);
              a *= 0.5;
            }
            return s;
          }
          `
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          vec2 wp = vTerrainWorldPos.xz;
          float h = vTerrainWorldPos.y;
          vec3 nW = normalize(vTerrainNormalW);
          float slope = 1.0 - clamp(nW.y, 0.0, 1.0);

          float macroVar = tfbm(wp * 0.0014);
          float detailVar = tfbm(wp * 0.022);
          float microVar = tnoise(wp * 0.16);

          // Luminous Ghibli-inspired sunlit emerald & golden meadow patchwork fields!
          vec2 warpedFieldUv = wp * 0.0046 + vec2(tfbm(wp * 0.0009) * 1.35, tfbm(wp * 0.0009 + 9.2) * 1.35);
          vec2 fieldCell = floor(warpedFieldUv);
          vec2 fieldFrac = fract(warpedFieldUv);
          float cellId = thash(fieldCell);

          vec3 fieldCol1 = vec3(0.21, 0.48, 0.19); // Luminous Ghibli spring emerald
          vec3 fieldCol2 = vec3(0.35, 0.56, 0.22); // Warm sunlit chartreuse meadow
          vec3 fieldCol3 = vec3(0.52, 0.55, 0.25); // Golden wheat/barley field
          vec3 fieldCol4 = vec3(0.24, 0.40, 0.18); // Rich clover pasture
          vec3 parcelColor = cellId < 0.34 ? fieldCol1 : (cellId < 0.65 ? fieldCol2 : (cellId < 0.85 ? fieldCol3 : fieldCol4));

          float cropRows = sin((wp.x * cos(cellId * 6.28) + wp.y * sin(cellId * 6.28)) * 0.28) * 0.028;
          parcelColor += cropRows;

          // Subtle sunlit wildflower speckles in meadows
          float flowerNoise = tnoise(wp * 0.32);
          if (flowerNoise > 0.78 && cellId < 0.5) {
            parcelColor = mix(parcelColor, vec3(0.95, 0.88, 0.42), 0.35);
          }

          float borderDist = min(min(fieldFrac.x, 1.0 - fieldFrac.x), min(fieldFrac.y, 1.0 - fieldFrac.y));
          float hedgerow = 1.0 - smoothstep(0.015, 0.048, borderDist);
          parcelColor = mix(parcelColor, vec3(0.11, 0.26, 0.11), hedgerow * 0.75);

          float farmlandMask = (1.0 - smoothstep(46.0, 120.0, h)) * (1.0 - smoothstep(0.04, 0.15, slope)) * smoothstep(6.0, 16.0, h);
          vec3 hillGrass = mix(vec3(0.18, 0.40, 0.17), vec3(0.32, 0.51, 0.22), macroVar);
          vec3 deepForest = vec3(0.11, 0.28, 0.14);
          vec3 landColor = mix(mix(hillGrass, deepForest, smoothstep(95.0, 360.0, h) * 0.62), parcelColor, farmlandMask * 0.88);

          // Golden-white sandy coastal beaches & river pebbles
          float beachMask = 1.0 - smoothstep(1.2, 9.5, h);
          vec3 sandColor = mix(vec3(0.72, 0.66, 0.50), vec3(0.86, 0.81, 0.66), detailVar);
          landColor = mix(landColor, sandColor, beachMask * (1.0 - smoothstep(0.25, 0.5, slope)));

          // Clean warm-limestone & cool-slate cliff faces
          float rockMask = smoothstep(0.22, 0.45, slope + max(0.0, h - 380.0) * 0.00045);
          float strata = tnoise(vec2(wp.x * 0.008, h * 0.055));
          vec3 rockCol = mix(vec3(0.35, 0.36, 0.39), vec3(0.54, 0.51, 0.47), strata * 0.72 + microVar * 0.28);
          landColor = mix(landColor, rockCol, clamp(rockMask, 0.0, 1.0));

          // Crisp sunlit alpine snow peaks
          float snowHeightMask = smoothstep(555.0, 760.0, h + macroVar * 90.0);
          float snowSlopeKeep = 1.0 - smoothstep(0.42, 0.72, slope);
          float snowMask = clamp(snowHeightMask * (0.35 + 0.65 * snowSlopeKeep), 0.0, 1.0);
          vec3 snowCol = vec3(0.96, 0.98, 1.0) * (0.95 + 0.05 * microVar);
          landColor = mix(landColor, snowCol, snowMask);

          landColor *= 0.93 + 0.15 * detailVar * (1.0 - snowMask * 0.6);

          // CLEAN GHIBLI-STYLE CLOUD SHADOWS: crisp yet soft edges with cool sky-blue shadow tint!
          vec2 shadowUv = (wp - uCloudDrift) * 0.00058;
          float cloudShadow = smoothstep(0.50, 0.60, tfbm(shadowUv));
          vec3 coolShadowed = landColor * mix(vec3(1.0), uShadowTint * 1.12, 0.48);
          landColor = mix(landColor, coolShadowed * 0.74, cloudShadow);

          diffuseColor.rgb *= landColor;
          `
        );
    };

    return mat;
  }

  /**
   * Detailed Sparkling Ocean, Flowing River & Mirror Lake Shader with
   * shallow turquoise lagoons, shoreline foam waves, and Ghibli diamond sun glints!
   */
  private createWaterMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: this.shaderUniforms.uTime,
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, -0.5) },
        uSunColor: { value: new THREE.Color('#fffaf0') },
        uSkyHorizon: { value: new THREE.Color('#8ec8f6') },
        uSkyZenith: { value: new THREE.Color('#0b357a') },
        uFogColor: { value: new THREE.Color('#95cbf5') },
        uFogDensity: { value: 0.000078 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying vec2 vUv;
        varying float vViewDist;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vec4 mv = viewMatrix * wp;
          vViewDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vWorldPos;
        varying vec2 vUv;
        varying float vViewDist;

        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyHorizon;
        uniform vec3 uSkyZenith;
        uniform vec3 uFogColor;
        uniform float uFogDensity;

        float whash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        float wnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(whash(i), whash(i + vec2(1.0, 0.0)), f.x),
            mix(whash(i + vec2(0.0, 1.0)), whash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          // Layered flowing water ripples
          vec2 uv1 = vWorldPos.xz * 0.028 + vec2(uTime * 0.42, -uTime * 0.34);
          vec2 uv2 = vWorldPos.xz * 0.075 + vec2(-uTime * 0.31, uTime * 0.48);
          vec2 uv3 = vWorldPos.xz * 0.19 + vec2(uTime * 0.65, uTime * 0.52);
          float w1 = wnoise(uv1);
          float w2 = wnoise(uv2);
          float w3 = wnoise(uv3);

          vec3 N = normalize(vec3(
            (w1 - 0.5) * 0.16 + (w2 - 0.5) * 0.11 + (w3 - 0.5) * 0.06,
            1.0,
            (w2 - 0.5) * 0.16 - (w1 - 0.5) * 0.10 + (w3 - 0.5) * 0.06
          ));
          vec3 V = normalize(cameraPosition - vWorldPos);

          // Vibrant Ghibli cobalt-turquoise water palette!
          float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.6);
          vec3 deepCobalt = vec3(0.04, 0.24, 0.48);
          vec3 turquoiseLagoon = vec3(0.08, 0.52, 0.64);
          vec3 reflSky = mix(uSkyZenith, uSkyHorizon, 0.68);

          float shallowMix = smoothstep(0.25, 0.85, w1 * 0.6 + w2 * 0.4);
          vec3 baseWater = mix(deepCobalt, turquoiseLagoon, 0.38 + shallowMix * 0.36);
          vec3 waterCol = mix(baseWater, reflSky, clamp(0.18 + fresnel * 0.76, 0.0, 0.90));

          // Subtle riverbank / shoreline white foam ribbons
          float edgeDist = min(vUv.x, 1.0 - vUv.x);
          if (vWorldPos.y > 0.5 && edgeDist < 0.14) {
            float bankFoam = (1.0 - smoothstep(0.02, 0.14, edgeDist)) * smoothstep(0.42, 0.72, w2);
            waterCol = mix(waterCol, vec3(0.94, 0.98, 1.0), bankFoam * 0.75);
          }

          // Specular Sun Path + Ghibli Dancing Diamond Sun Sparkles!
          vec3 H = normalize(uSunDir + V);
          float ndh = max(dot(N, H), 0.0);
          float specRibbon = pow(ndh, 180.0) * 1.55 + pow(ndh, 28.0) * 0.20;

          // Crisp diamond glitter sparkles on sunlit wavelets
          vec2 sparkleGrid = floor(vWorldPos.xz * 0.35 + vec2(uTime * 0.8, -uTime * 0.6));
          float spRnd = whash(sparkleGrid);
          float spFlash = smoothstep(0.965, 0.998, spRnd) * pow(ndh, 14.0) * (1.0 - smoothstep(400.0, 3800.0, vViewDist));
          waterCol += uSunColor * (specRibbon + spFlash * 2.4);

          float fog = 1.0 - exp(-pow(vViewDist * uFogDensity, 2.0));
          waterCol = mix(waterCol, uFogColor, clamp(fog, 0.0, 1.0));

          gl_FragColor = vec4(waterCol, 0.95);
        }
      `,
    });
  }

  private buildFlowingRiverAndLake(): void {
    // 1. Continuous 3D Flowing River Water Ribbon (z from +2350 to -6450, width 62m)
    const zSteps = 220;
    const halfWidth = 31;
    const positions = new Float32Array((zSteps + 1) * 2 * 3);
    const uvs = new Float32Array((zSteps + 1) * 2 * 2);
    const indices: number[] = [];

    for (let i = 0; i <= zSteps; i++) {
      const t = i / zSteps;
      const z = 2350 - t * 8800;
      const cx = this.riverCenterX(z);
      const y = this.riverSurfaceY(z);

      const vIdx = i * 2;
      positions[vIdx * 3 + 0] = cx - halfWidth;
      positions[vIdx * 3 + 1] = y;
      positions[vIdx * 3 + 2] = z;
      uvs[vIdx * 2 + 0] = 0;
      uvs[vIdx * 2 + 1] = t * 40;

      positions[(vIdx + 1) * 3 + 0] = cx + halfWidth;
      positions[(vIdx + 1) * 3 + 1] = y;
      positions[(vIdx + 1) * 3 + 2] = z;
      uvs[(vIdx + 1) * 2 + 0] = 1;
      uvs[(vIdx + 1) * 2 + 1] = t * 40;

      if (i < zSteps) {
        const a = vIdx;
        const b = vIdx + 1;
        const c = vIdx + 2;
        const d = vIdx + 3;
        indices.push(a, b, c, b, d, c);
      }
    }

    const riverGeo = new THREE.BufferGeometry();
    riverGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    riverGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    riverGeo.setIndex(indices);
    riverGeo.computeVertexNormals();

    this.riverMesh = new THREE.Mesh(riverGeo, this.waterMat);
    this.group.add(this.riverMesh);

    // 2. Emerald Alpine Mirror Lake Water Disc at (-260, 12.5, -4750)
    const lakeGeo = new THREE.CircleGeometry(475, 48);
    lakeGeo.rotateX(-Math.PI / 2);
    lakeGeo.scale(1.05, 1, 1.32);
    this.lakeMesh = new THREE.Mesh(lakeGeo, this.waterMat);
    this.lakeMesh.position.set(-260, 12.52, -4750);
    this.group.add(this.lakeMesh);
  }

  private createHighwayTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // Smooth dark slate asphalt with clean gravel shoulders
    ctx.fillStyle = '#5a6354';
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = '#333840';
    ctx.fillRect(18, 0, 220, 512);

    // Crisp white edge lines
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(26, 0, 6, 512);
    ctx.fillRect(224, 0, 6, 512);

    // Aviation/Highway bright yellow dashed centerline (great visual alignment for road landings!)
    ctx.fillStyle = '#fbbf24';
    for (let y = 16; y < 512; y += 64) {
      ctx.fillRect(125, y, 6, 36);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  }

  /**
   * Builds the 7.4 km Landable Grand Valley Scenic Highway + Cross-Valley River Bridge!
   */
  private buildLandableHighwayAndBridge(): void {
    const roadTex = this.createHighwayTexture();
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTex,
      roughness: 0.8,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const zSteps = 240;
    const halfWidth = 9.5; // 19m wide landable highway!
    const positions = new Float32Array((zSteps + 1) * 2 * 3);
    const uvs = new Float32Array((zSteps + 1) * 2 * 2);
    const indices: number[] = [];

    for (let i = 0; i <= zSteps; i++) {
      const t = i / zSteps;
      const z = 2500 - t * 7400; // From +2500 (south of airport) to -4900 (Alpine Lake!)
      const cx = this.highwayCenterX(z);
      const y = this.highwayElevation(z) + 0.16;

      // Tangent angle for perpendicular width
      const nextZ = z - 10;
      const dx = this.highwayCenterX(nextZ) - cx;
      const len = Math.hypot(dx, -10);
      const perpX = -(-10) / len;
      const perpZ = dx / len;

      const vIdx = i * 2;
      positions[vIdx * 3 + 0] = cx - perpX * halfWidth;
      positions[vIdx * 3 + 1] = y;
      positions[vIdx * 3 + 2] = z - perpZ * halfWidth;
      uvs[vIdx * 2 + 0] = 0;
      uvs[vIdx * 2 + 1] = t * 110;

      positions[(vIdx + 1) * 3 + 0] = cx + perpX * halfWidth;
      positions[(vIdx + 1) * 3 + 1] = y;
      positions[(vIdx + 1) * 3 + 2] = z + perpZ * halfWidth;
      uvs[(vIdx + 1) * 2 + 0] = 1;
      uvs[(vIdx + 1) * 2 + 1] = t * 110;

      if (i < zSteps) {
        const a = vIdx;
        const b = vIdx + 1;
        const c = vIdx + 2;
        const d = vIdx + 3;
        indices.push(a, b, c, b, d, c);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    roadGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    roadGeo.setIndex(indices);
    roadGeo.computeVertexNormals();

    const highwayMesh = new THREE.Mesh(roadGeo, roadMat);
    highwayMesh.receiveShadow = true;
    this.highwayGroup.add(highwayMesh);

    // Cross-Valley Scenic Causeway Bridge at z = -1220 spanning right across the shimmering River!
    const bridgeLen = 850;
    const bridgeDeckGeo = new THREE.BoxGeometry(bridgeLen, 1.1, 18);
    const bridgeConcreteMat = new THREE.MeshStandardMaterial({ color: 0xe2dfd7, roughness: 0.7 });
    const bridgeDeck = new THREE.Mesh(bridgeDeckGeo, bridgeConcreteMat);
    bridgeDeck.position.set(-40, 30.85, -1220);
    bridgeDeck.castShadow = true;
    bridgeDeck.receiveShadow = true;
    this.highwayGroup.add(bridgeDeck);

    // Asphalt top surface on the Bridge Deck
    const bridgeTopGeo = new THREE.PlaneGeometry(17.5, bridgeLen);
    bridgeTopGeo.rotateX(-Math.PI / 2);
    bridgeTopGeo.rotateY(Math.PI / 2);
    const bridgeTop = new THREE.Mesh(bridgeTopGeo, roadMat);
    bridgeTop.position.set(-40, 31.45, -1220);
    bridgeTop.receiveShadow = true;
    this.highwayGroup.add(bridgeTop);

    // Bridge Support Piers standing in the river & riverbank
    const pierGeo = new THREE.BoxGeometry(3.2, 26, 14);
    for (let px = -400; px <= 320; px += 90) {
      const pier = new THREE.Mesh(pierGeo, bridgeConcreteMat);
      pier.position.set(px, 18, -1220);
      pier.castShadow = true;
      this.highwayGroup.add(pier);
    }

    // Warm Glowing Highway Lantern Posts along the scenic road
    const lampCount = 74;
    const lampBulbGeo = new THREE.SphereGeometry(0.55, 6, 6);
    const lampInst = new THREE.InstancedMesh(lampBulbGeo, this.highwayLampMat, lampCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < lampCount; i++) {
      const z = 2300 - i * 95;
      const x = this.highwayCenterX(z) + (i % 2 === 0 ? 11.2 : -11.2);
      const y = this.highwayElevation(z) + 4.8;
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      lampInst.setMatrixAt(i, dummy.matrix);
    }
    lampInst.instanceMatrix.needsUpdate = true;
    this.highwayGroup.add(lampInst);
  }

  private buildAirports(): void {
    const cx = this.airport.runwayCenter.x;
    const cz = this.airport.runwayCenter.z;
    const cy = this.airport.elevation;
    const rwLen = this.airport.runwayLength;
    const rwWid = this.airport.runwayWidth;

    const apronGeo = new THREE.PlaneGeometry(rwWid + 92, rwLen + 120);
    apronGeo.rotateX(-Math.PI / 2);
    const apron = new THREE.Mesh(
      apronGeo,
      new THREE.MeshStandardMaterial({ color: 0x3b5934, roughness: 0.92 })
    );
    apron.position.set(cx + 18, cy + 0.05, cz);
    apron.receiveShadow = true;
    this.airportGroup.add(apron);

    // High-res Runway Texture
    const rCanvas = document.createElement('canvas');
    rCanvas.width = 256;
    rCanvas.height = 2048;
    const ctx = rCanvas.getContext('2d')!;
    ctx.fillStyle = '#2d3138';
    ctx.fillRect(0, 0, 256, 2048);

    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(12, 30, 5, 1988);
    ctx.fillRect(239, 30, 5, 1988);

    for (let k = 0; k < 6; k++) {
      ctx.fillRect(32 + k * 14, 42, 8, 72);
      ctx.fillRect(148 + k * 14, 42, 8, 72);
      ctx.fillRect(32 + k * 14, 1934, 8, 72);
      ctx.fillRect(148 + k * 14, 1934, 8, 72);
    }
    ctx.fillRect(48, 310, 28, 110);
    ctx.fillRect(180, 310, 28, 110);
    ctx.fillRect(48, 1628, 28, 110);
    ctx.fillRect(180, 1628, 28, 110);

    for (let y = 180; y < 1860; y += 76) {
      ctx.fillRect(124, y, 8, 42);
    }

    const rTex = new THREE.CanvasTexture(rCanvas);
    rTex.anisotropy = 4;
    const runwayMat = new THREE.MeshStandardMaterial({
      map: rTex,
      roughness: 0.8,
      metalness: 0.05,
    });

    const runwayGeo = new THREE.PlaneGeometry(rwWid, rwLen);
    runwayGeo.rotateX(-Math.PI / 2);
    const runwayMesh = new THREE.Mesh(runwayGeo, runwayMat);
    runwayMesh.position.set(cx, cy + 0.14, cz);
    runwayMesh.receiveShadow = true;
    this.airportGroup.add(runwayMesh);

    // Parallel Taxiway + Hangars + Control Tower
    const taxiGeo = new THREE.PlaneGeometry(44, 430);
    taxiGeo.rotateX(-Math.PI / 2);
    const tarmac = new THREE.Mesh(
      taxiGeo,
      new THREE.MeshStandardMaterial({ color: 0x363b42, roughness: 0.85 })
    );
    tarmac.position.set(cx + 46, cy + 0.11, cz + 40);
    tarmac.receiveShadow = true;
    this.airportGroup.add(tarmac);

    const hangarMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.55 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xb84a39, roughness: 0.55 });

    for (let h = 0; h < 2; h++) {
      const hangar = new THREE.Mesh(new THREE.BoxGeometry(24, 9, 30), hangarMat);
      hangar.position.set(cx + 68, cy + 4.5, cz - 20 + h * 48);
      hangar.castShadow = true;
      hangar.receiveShadow = true;
      this.airportGroup.add(hangar);

      const hRoof = new THREE.Mesh(
        new THREE.CylinderGeometry(12.4, 12.4, 30.4, 16, 1, false, 0, Math.PI),
        roofMat
      );
      hRoof.rotation.z = Math.PI / 2;
      hRoof.rotation.y = Math.PI / 2;
      hRoof.position.set(cx + 68, cy + 9.0, cz - 20 + h * 48);
      hRoof.castShadow = true;
      this.airportGroup.add(hRoof);
    }

    const towerShaft = new THREE.Mesh(new THREE.BoxGeometry(8, 22, 8), hangarMat);
    towerShaft.position.set(cx + 66, cy + 11, cz + 92);
    towerShaft.castShadow = true;
    this.airportGroup.add(towerShaft);

    const towerCab = new THREE.Mesh(
      new THREE.CylinderGeometry(7.2, 5.6, 5.2, 8),
      new THREE.MeshStandardMaterial({
        color: 0x89c4f4,
        roughness: 0.15,
        metalness: 0.6,
        emissive: 0x3b78a8,
        emissiveIntensity: 0.35,
      })
    );
    towerCab.position.set(cx + 66, cy + 24.5, cz + 92);
    this.airportGroup.add(towerCab);

    // Orange & White Windsock beside Runway 36 threshold
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, 7, 6),
      new THREE.MeshStandardMaterial({ color: 0xdddddd })
    );
    pole.position.set(cx - 26, cy + 3.5, cz + 380);
    this.airportGroup.add(pole);
    const sock = new THREE.Mesh(
      new THREE.ConeGeometry(0.75, 3.4, 8, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xf97316, side: THREE.DoubleSide })
    );
    sock.rotation.z = Math.PI / 2;
    sock.position.set(cx - 24.2, cy + 6.7, cz + 380);
    this.airportGroup.add(sock);

    this.beaconLightObj.position.set(cx + 66, cy + 29, cz + 92);
    this.airportGroup.add(this.beaconLightObj);

    // Runway Edge Lights
    const edgeLightGeo = new THREE.SphereGeometry(0.48, 6, 6);
    const numPairs = 26;
    const edgeInst = new THREE.InstancedMesh(edgeLightGeo, this.runwayLightMat, numPairs * 2);
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let i = 0; i < numPairs; i++) {
      const lz = cz - rwLen * 0.48 + (i / (numPairs - 1)) * rwLen * 0.96;
      dummy.position.set(cx - rwWid * 0.5 - 1.2, cy + 0.5, lz);
      dummy.updateMatrix();
      edgeInst.setMatrixAt(idx++, dummy.matrix);

      dummy.position.set(cx + rwWid * 0.5 + 1.2, cy + 0.5, lz);
      dummy.updateMatrix();
      edgeInst.setMatrixAt(idx++, dummy.matrix);
    }
    edgeInst.instanceMatrix.needsUpdate = true;
    this.airportGroup.add(edgeInst);

    // 2. Second Airport: Azure Island Coastal Airstrip (-3350, 18.0, -4850)
    const islGeo = new THREE.PlaneGeometry(28, 680);
    islGeo.rotateX(-Math.PI / 2);
    const islMesh = new THREE.Mesh(islGeo, runwayMat);
    islMesh.position.copy(this.airport.islandRunwayCenter).add(new THREE.Vector3(0, 0.14, 0));
    islMesh.receiveShadow = true;
    this.airportGroup.add(islMesh);
  }

  /**
   * Builds Ghibli-inspired White Windmills, Sailboats on the bay/lake, and gliding white Seabirds!
   */
  private buildWindmillsSailboatsAndBirds(): void {
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xfbf9f4, roughness: 0.6 });
    const terracottaMat = new THREE.MeshStandardMaterial({ color: 0xb54b38, roughness: 0.7 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4c35, roughness: 0.8 });

    // 6 Scenic Farmland Windmills
    const millCoords: Array<[number, number]> = [
      [410, -280],
      [480, -920],
      [-460, -1580],
      [420, -2450],
      [-510, -3300],
      [350, -3950],
    ];

    for (const [mx, mz] of millCoords) {
      const my = this.getTerrainHeight(mx, mz);
      if (my < 15) continue;

      const mill = new THREE.Group();
      mill.position.set(mx, my, mz);

      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 4.2, 18, 12), whiteMat);
      tower.position.y = 9;
      tower.castShadow = true;
      tower.receiveShadow = true;
      mill.add(tower);

      const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 3.2, 12), terracottaMat);
      cap.position.y = 19.6;
      mill.add(cap);

      const rotor = new THREE.Group();
      rotor.position.set(0, 16.5, -2.5);
      const bladeGeo = new THREE.BoxGeometry(1.1, 11.5, 0.15);
      bladeGeo.translate(0, 6.0, 0);
      for (let b = 0; b < 4; b++) {
        const bWrap = new THREE.Group();
        bWrap.rotation.z = (b * Math.PI) / 2;
        const blade = new THREE.Mesh(bladeGeo, whiteMat);
        blade.castShadow = true;
        bWrap.add(blade);
        rotor.add(bWrap);
      }
      mill.add(rotor);
      this.windmillRotors.push(rotor);
      this.propsGroup.add(mill);
    }

    // White Sailboats on the Alpine Lake & Western Ocean Bay
    const boatSpots: Array<[number, number, number]> = [
      [-230, 12.5, -4620],
      [-330, 12.5, -4880],
      [-180, 12.5, -4960],
      [-2800, 0.0, -5200],
      [-3100, 0.0, -5650],
      [-3700, 0.0, -4300],
      [-4100, 0.0, -5100],
      [-2650, 0.0, -6100],
    ];

    for (let i = 0; i < boatSpots.length; i++) {
      const [bx, by, bz] = boatSpots[i];
      if (by === 0.0 && this.getTerrainHeight(bx, bz) > -1.0) continue;

      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 7.8), woodMat);
      hull.position.y = 0.4;
      boat.add(hull);

      const sailShape = new THREE.Shape();
      sailShape.moveTo(0, 0);
      sailShape.lineTo(0, 9.5);
      sailShape.lineTo(4.6, 0.5);
      sailShape.closePath();
      const sail = new THREE.Mesh(
        new THREE.ShapeGeometry(sailShape),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
      );
      sail.rotation.y = Math.PI / 2;
      sail.position.set(0, 1.0, -2.0);
      boat.add(sail);

      boat.position.set(bx, by, bz);
      boat.rotation.y = i * 1.1;
      this.propsGroup.add(boat);
    }

    // Graceful White Seabird Flock wheeling gently over the sunlit valley!
    const birdMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    for (let b = 0; b < 22; b++) {
      const bird = new THREE.Group();
      const wingGeo = new THREE.PlaneGeometry(2.4, 0.65);
      const lw = new THREE.Mesh(wingGeo, birdMat);
      lw.position.x = -1.1;
      lw.rotation.x = -Math.PI / 2;
      lw.rotation.y = 0.25;
      const rw = new THREE.Mesh(wingGeo, birdMat);
      rw.position.x = 1.1;
      rw.rotation.x = -Math.PI / 2;
      rw.rotation.y = -0.25;
      bird.add(lw, rw);

      const ang = (b / 22) * Math.PI * 2;
      const rad = 60 + (b % 5) * 28;
      bird.position.set(Math.cos(ang) * rad, (b % 4) * 14, Math.sin(ang) * rad);
      bird.rotation.y = -ang;
      this.birdFlockGroup.add(bird);
    }
    this.birdFlockGroup.position.set(-120, 210, -1400);
  }

  public rebuildTerrainAndScenery(): void {
    if (this.terrainMesh) {
      this.group.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      this.terrainMesh = null;
    }
    for (const m of [
      this.treeTrunksMesh,
      this.pineCanopyMesh,
      this.lushCanopyMesh,
      this.settlementWallsMesh,
      this.settlementRoofsMesh,
    ]) {
      if (m) {
        this.group.remove(m);
        m.geometry.dispose();
      }
    }

    const segs = this.currentQuality.terrainSegments;
    const geo = new THREE.PlaneGeometry(this.terrainSize, this.terrainSize, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i) - 1800;
      posAttr.setZ(i, vz);
      posAttr.setY(i, this.getTerrainHeight(vx, vz));
    }
    geo.computeVertexNormals();

    this.terrainMesh = new THREE.Mesh(geo, this.terrainMat);
    this.terrainMesh.receiveShadow = this.currentQuality.shadowsEnabled;
    this.group.add(this.terrainMesh);

    this.buildInstancedForest();
    this.buildInstancedSettlements();
  }

  private buildInstancedForest(): void {
    const maxTrees = this.currentQuality.treeCount;
    const pineMax = Math.floor(maxTrees * 0.5);
    const lushMax = maxTrees - pineMax;

    const trunkGeo = new THREE.CylinderGeometry(0.42, 0.68, 3.6, 5);
    trunkGeo.translate(0, 1.8, 0);
    const pineGeo = new THREE.ConeGeometry(3.6, 10.8, 6);
    pineGeo.translate(0, 7.8, 0);
    // Rounded fluffy Ghibli broadleaf tree crown!
    const lushGeo = new THREE.IcosahedronGeometry(4.6, 1);
    lushGeo.scale(1.08, 0.92, 1.08);
    lushGeo.translate(0, 6.8, 0);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x523b28, roughness: 0.95 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, maxTrees);
    const pines = new THREE.InstancedMesh(pineGeo, canopyMat, pineMax);
    const lushes = new THREE.InstancedMesh(lushGeo, canopyMat, lushMax);

    pines.castShadow = this.currentQuality.shadowsEnabled;
    lushes.castShadow = this.currentQuality.shadowsEnabled;
    pines.receiveShadow = this.currentQuality.shadowsEnabled;
    lushes.receiveShadow = this.currentQuality.shadowsEnabled;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let placedTotal = 0;
    let placedPine = 0;
    let placedLush = 0;
    let attempts = 0;

    while (placedTotal < maxTrees && attempts < maxTrees * 4) {
      attempts++;
      const r1 = hash2(attempts, 811);
      const r2 = hash2(attempts, 812);
      const r3 = hash2(attempts, 813);

      const x = (r1 - 0.5) * 14500;
      const z = (r2 - 0.58) * 14500;

      if (Math.abs(x) < 260 && z > 850 && z < 2500) continue;
      if (Math.abs(x + 3350) < 150 && Math.abs(z + 4850) < 520) continue;
      if (Math.abs(x - this.riverCenterX(z)) < 58) continue;
      if (Math.abs(x - this.highwayCenterX(z)) < 28) continue;
      if (Math.abs(z + 1220) < 24 && x > -500 && x < 420) continue;

      const y = this.getTerrainHeight(x, z);
      if (y < 9.5 || y > 510) continue;

      const densityChance = y > 50 ? 0.88 : 0.25;
      if (noise2D(x * 0.003, z * 0.003) + densityChance < 0.4) continue;

      const scale = 0.85 + r3 * 1.15;
      dummy.position.set(x, y - 0.3, z);
      dummy.rotation.set(0, r1 * Math.PI * 2, 0);
      dummy.scale.set(scale, scale * (0.92 + 0.28 * r2), scale);
      dummy.updateMatrix();

      trunks.setMatrixAt(placedTotal, dummy.matrix);

      const preferLush = y < 185 && placedLush < lushMax;
      if ((preferLush && r2 > 0.28) || placedPine >= pineMax) {
        lushes.setMatrixAt(placedLush, dummy.matrix);
        // Vibrant sunlit Ghibli broadleaf greens
        color.setHSL(0.27 + (r3 - 0.5) * 0.06, 0.52 + r2 * 0.16, 0.24 + r1 * 0.12);
        lushes.setColorAt(placedLush, color);
        placedLush++;
      } else {
        pines.setMatrixAt(placedPine, dummy.matrix);
        color.setHSL(0.31 + (r3 - 0.5) * 0.05, 0.44 + r2 * 0.14, 0.17 + r1 * 0.1);
        pines.setColorAt(placedPine, color);
        placedPine++;
      }

      placedTotal++;
    }

    trunks.count = placedTotal;
    pines.count = placedPine;
    lushes.count = placedLush;
    trunks.instanceMatrix.needsUpdate = true;
    pines.instanceMatrix.needsUpdate = true;
    lushes.instanceMatrix.needsUpdate = true;
    if (pines.instanceColor) pines.instanceColor.needsUpdate = true;
    if (lushes.instanceColor) lushes.instanceColor.needsUpdate = true;

    this.treeTrunksMesh = trunks;
    this.pineCanopyMesh = pines;
    this.lushCanopyMesh = lushes;
    this.group.add(trunks, pines, lushes);
  }

  private buildInstancedSettlements(): void {
    const hubs: Array<[number, number]> = [
      [340, -420],
      [-390, -1850],
      [360, -3200],
      [180, -4550],
      [-1250, -2900],
    ];

    const maxBuildings = this.currentQuality.buildingCount;
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    wallGeo.translate(0, 0.5, 0);
    const roofGeo = new THREE.ConeGeometry(0.82, 0.58, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.translate(0, 1.28, 0);

    const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 });
    const walls = new THREE.InstancedMesh(wallGeo, this.settlementWallMat, maxBuildings);
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, maxBuildings);
    walls.castShadow = this.currentQuality.shadowsEnabled;
    roofs.castShadow = this.currentQuality.shadowsEnabled;

    const dummy = new THREE.Object3D();
    const roofCol = new THREE.Color();
    let placed = 0;

    for (let i = 0; i < maxBuildings * 3 && placed < maxBuildings; i++) {
      const hub = hubs[i % hubs.length];
      const r1 = hash2(i, 901);
      const r2 = hash2(i, 902);
      const r3 = hash2(i, 903);

      const ang = r1 * Math.PI * 2;
      const rad = 40 + Math.sqrt(r2) * 290;
      const x = hub[0] + Math.cos(ang) * rad;
      const z = hub[1] + Math.sin(ang) * rad;

      if (Math.abs(x - this.riverCenterX(z)) < 58) continue;
      if (Math.abs(x - this.highwayCenterX(z)) < 26) continue;

      const y = this.getTerrainHeight(x, z);
      if (y < 14 || y > 135) continue;

      const w = 9 + r1 * 8;
      const h = 5.5 + r3 * 5.5;
      const d = 9 + r2 * 9;

      dummy.position.set(x, y - 0.4, z);
      dummy.rotation.set(0, r3 * Math.PI, 0);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();

      walls.setMatrixAt(placed, dummy.matrix);
      roofs.setMatrixAt(placed, dummy.matrix);

      // Warm Mediterranean / Ghibli terracotta, cobalt-slate, and russet roofs!
      if (r1 < 0.62) roofCol.setHex(0xb84a39);
      else if (r1 < 0.85) roofCol.setHex(0x3f5b78);
      else roofCol.setHex(0x7a5238);
      roofs.setColorAt(placed, roofCol);

      placed++;
    }

    walls.count = placed;
    roofs.count = placed;
    walls.instanceMatrix.needsUpdate = true;
    roofs.instanceMatrix.needsUpdate = true;
    if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;

    this.settlementWallsMesh = walls;
    this.settlementRoofsMesh = roofs;
    this.group.add(walls, roofs);
  }

  public applyPreset(preset: AtmospherePreset, sunDir: THREE.Vector3): void {
    const wu = this.waterMat.uniforms;
    wu.uSunDir.value.copy(sunDir);
    wu.uSunColor.value.copy(preset.sunColor);
    wu.uSkyHorizon.value.copy(preset.skyHorizon);
    wu.uSkyZenith.value.copy(preset.skyZenith);
    wu.uFogColor.value.copy(preset.fogColor);
    wu.uFogDensity.value = preset.fogDensity;

    this.shaderUniforms.uNightLights.value = preset.nightLights;
    this.shaderUniforms.uShadowTint.value.copy(preset.cloudShadowColor);
    this.settlementWallMat.emissiveIntensity = preset.nightLights * 0.34;
    this.beaconLightObj.intensity = 0.6 + preset.nightLights * 3.5;
    this.runwayLightMat.color.setHex(preset.nightLights > 0.3 ? 0xffe6a3 : 0xdde6ee);
    this.highwayLampMat.color.setHex(preset.nightLights > 0.25 ? 0xffd27d : 0xd8dee6);
  }

  public applyGraphicsQuality(quality: GraphicsConfig): void {
    const needsRebuild =
      quality.terrainSegments !== this.currentQuality.terrainSegments ||
      quality.treeCount !== this.currentQuality.treeCount ||
      quality.shadowsEnabled !== this.currentQuality.shadowsEnabled;
    this.currentQuality = quality;
    if (needsRebuild) {
      this.rebuildTerrainAndScenery();
    }
  }

  public update(elapsed: number, focusPos: THREE.Vector3): void {
    this.shaderUniforms.uTime.value = elapsed;
    this.shaderUniforms.uCloudDrift.value.set(elapsed * 5.5, -elapsed * 2.4);

    this.oceanMesh.position.x = Math.round(focusPos.x / 500) * 500;
    this.oceanMesh.position.z = Math.round(focusPos.z / 500) * 500;

    // Spin farmland windmills peacefully
    for (let i = 0; i < this.windmillRotors.length; i++) {
      this.windmillRotors[i].rotation.z = elapsed * 0.55 + i;
    }

    // Wheel white seabird flock lazily through the sunlit valley air
    this.birdFlockGroup.rotation.y = elapsed * 0.12;
  }

  public dispose(): void {
    if (this.terrainMesh) this.terrainMesh.geometry.dispose();
    this.outerSkirtMesh.geometry.dispose();
    this.oceanMesh.geometry.dispose();
    this.riverMesh.geometry.dispose();
    this.lakeMesh.geometry.dispose();
    this.terrainMat.dispose();
    this.waterMat.dispose();
    this.settlementWallMat.dispose();
    this.runwayLightMat.dispose();
    this.highwayLampMat.dispose();
  }
}
