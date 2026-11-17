import * as THREE from 'three';
import { AtmospherePreset, GraphicsConfig } from '../types';
import { clamp, fbm2D, hash2, noise2D, ridged2D, smoothstep } from '../utils/noise';

export interface AirportInfo {
  runwayCenter: THREE.Vector3;
  runwayLength: number;
  runwayWidth: number;
  elevation: number;
  thresholdSouth: THREE.Vector3; // Takeoff heading North (-Z) straight into Cloud Canyon!
  thresholdNorth: THREE.Vector3;
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
  };

  private terrainMesh: THREE.Mesh | null = null;
  private outerSkirtMesh: THREE.Mesh;
  private oceanMesh: THREE.Mesh;
  private treeTrunksMesh: THREE.InstancedMesh | null = null;
  private treeCanopyMesh: THREE.InstancedMesh | null = null;
  private settlementWallsMesh: THREE.InstancedMesh | null = null;
  private settlementRoofsMesh: THREE.InstancedMesh | null = null;
  private airportGroup = new THREE.Group();

  private terrainMat: THREE.MeshStandardMaterial;
  private oceanMat: THREE.ShaderMaterial;
  private settlementWallMat: THREE.MeshStandardMaterial;
  private runwayLightMat: THREE.MeshBasicMaterial;
  private beaconLightObj: THREE.PointLight;

  private shaderUniforms = {
    uTime: { value: 0 },
    uCloudDrift: { value: new THREE.Vector2(0, 0) },
    uNightLights: { value: 0 },
  };

  private currentQuality: GraphicsConfig;
  private readonly terrainSize = 22000;

  constructor(scene: THREE.Scene, quality: GraphicsConfig) {
    this.currentQuality = quality;

    this.terrainMat = this.createTerrainMaterial();
    this.oceanMat = this.createOceanMaterial();

    this.settlementWallMat = new THREE.MeshStandardMaterial({
      color: 0xebe4d8,
      roughness: 0.78,
      metalness: 0.05,
      emissive: new THREE.Color(0xffb969),
      emissiveIntensity: 0.0,
    });

    this.runwayLightMat = new THREE.MeshBasicMaterial({
      color: 0xfff2cc,
    });

    // Huge ocean plane extending to far horizon
    const oceanGeo = new THREE.PlaneGeometry(64000, 64000, 96, 96);
    oceanGeo.rotateX(-Math.PI / 2);
    this.oceanMesh = new THREE.Mesh(oceanGeo, this.oceanMat);
    this.oceanMesh.position.y = 0.0;
    this.oceanMesh.receiveShadow = false;
    this.group.add(this.oceanMesh);

    // Distant low-poly outer coastal/island horizon ring
    const outerGeo = new THREE.RingGeometry(10800, 31000, 64, 4);
    outerGeo.rotateX(-Math.PI / 2);
    const outerMat = new THREE.MeshStandardMaterial({
      color: 0x2c4f54,
      roughness: 0.92,
      metalness: 0.0,
    });
    this.outerSkirtMesh = new THREE.Mesh(outerGeo, outerMat);
    this.outerSkirtMesh.position.y = -1.5;
    this.group.add(this.outerSkirtMesh);

    this.beaconLightObj = new THREE.PointLight(0x88ffaa, 0, 320);

    this.buildAirport();
    this.group.add(this.airportGroup);

    this.rebuildTerrainAndScenery();
    scene.add(this.group);
  }

  public riverCenterX(z: number): number {
    return -185 + Math.sin(z * 0.00085) * 240 + Math.cos(z * 0.00037 + 0.8) * 145;
  }

  public roadCenterX(z: number): number {
    return 215 + Math.sin(z * 0.00072 + 1.4) * 165;
  }

  /**
   * Exact continuous world height at any (x, z) coordinate in meters (sea level = 0m).
   */
  public getTerrainHeight(x: number, z: number): number {
    // Ocean / bay opening in the northwest & far outer world
    const distFromOrigin = Math.hypot(x, z + 1200);
    const coastFade = 1.0 - smoothstep(7200, 10600, distFromOrigin);

    // Scenic Western Bay & Islands (x < -2800 or z < -6200)
    const bayMask = smoothstep(-2400, -4800, x) + smoothstep(-5800, -8200, z);

    // Central Dream Valley corridor along X = 0 (width ~ 1550m each side)
    const absX = Math.abs(x);
    const valleyMask = 1.0 - smoothstep(550, 2350, absX);

    // Rolling valley floor & gentle hills
    const gentleRolling = fbm2D(x * 0.00045 + 3.1, z * 0.00045 - 1.7, 4) * 48 + 30;

    // Towering dramatic mountain ranges flanking East & West outer sides + Alpine peaks
    const mtnRidges = ridged2D(x * 0.00032 + 1.2, z * 0.00032 + 4.5, 5);
    const mtnDetail = fbm2D(x * 0.0012, z * 0.0012, 3) * 85;
    const eastBoost = smoothstep(900, 4200, x) * 1.18 + smoothstep(850, 3900, -x) * 0.78;
    const mountainHeight = (mtnRidges * 1120 + mtnDetail) * eastBoost;

    let h = gentleRolling * (0.45 + 0.55 * valleyMask) + mountainHeight * (1.0 - valleyMask * 0.88);

    // Submerge western bay while rising back up for picturesque green islands!
    if (bayMask > 0.001) {
      const islandNoise = ridged2D(x * 0.00065 - 7.3, z * 0.00065 + 2.1, 4);
      const islandH = (islandNoise - 0.42) * 340;
      h = THREE.MathUtils.lerp(h, islandH, clamp(bayMask, 0, 1));
    }

    h = h * coastFade - (1.0 - coastFade) * 28.0;

    // Carve meandering valley river & mountain lake at z = -4900
    const rx = this.riverCenterX(z);
    const riverDist = Math.abs(x - rx);
    const riverActive = smoothstep(2600, 1950, z) * smoothstep(-8500, -6800, z);
    if (riverActive > 0.01 && riverDist < 140) {
      const riverCut = (1.0 - smoothstep(18, 130, riverDist)) * 38.0 * riverActive;
      h -= riverCut;
    }

    // Scenic emerald lake basin around (-260, -4750)
    const lakeDist = Math.hypot((x + 260) * 0.85, (z + 4750) * 0.65);
    if (lakeDist < 580) {
      const lakeCut = (1.0 - smoothstep(240, 580, lakeDist)) * 46.0;
      h -= lakeCut;
    }

    // Smoothly grade flat plateau for Dream Valley Airport (x: 0, z: 1620, y: 28m)
    const dxAir = Math.abs(x - this.airport.runwayCenter.x);
    const dzAir = Math.abs(z - this.airport.runwayCenter.z);
    const airBlendX = 1.0 - smoothstep(115, 360, dxAir);
    const airBlendZ = 1.0 - smoothstep(560, 920, dzAir);
    const airFlatten = airBlendX * airBlendZ;
    if (airFlatten > 0.001) {
      h = THREE.MathUtils.lerp(h, this.airport.elevation, airFlatten);
    }

    return h;
  }

  private createTerrainMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.02,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.shaderUniforms.uTime;
      shader.uniforms.uCloudDrift = this.shaderUniforms.uCloudDrift;

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
          float detailVar = tfbm(wp * 0.018);
          float microVar = tnoise(wp * 0.12);

          // Lush green valley palette + patchwork agricultural fields (homage to ref.mp4!)
          vec2 warpedFieldUv = wp * 0.0046 + vec2(tfbm(wp * 0.0009) * 1.35, tfbm(wp * 0.0009 + 9.2) * 1.35);
          vec2 fieldCell = floor(warpedFieldUv);
          vec2 fieldFrac = fract(warpedFieldUv);
          float cellId = thash(fieldCell);

          vec3 fieldCol1 = vec3(0.20, 0.39, 0.16); // Rich emerald pasture
          vec3 fieldCol2 = vec3(0.31, 0.46, 0.20); // Sunlit spring meadow
          vec3 fieldCol3 = vec3(0.45, 0.48, 0.24); // Warm olive/golden crop parcel
          vec3 fieldCol4 = vec3(0.25, 0.34, 0.17); // Deep clover/orchard
          vec3 parcelColor = cellId < 0.32 ? fieldCol1 : (cellId < 0.62 ? fieldCol2 : (cellId < 0.84 ? fieldCol3 : fieldCol4));

          // Subtle crop rows & dark green hedgerow borders between fields
          float cropRows = sin((wp.x * cos(cellId * 6.28) + wp.y * sin(cellId * 6.28)) * 0.24) * 0.025;
          parcelColor += cropRows;
          float borderDist = min(min(fieldFrac.x, 1.0 - fieldFrac.x), min(fieldFrac.y, 1.0 - fieldFrac.y));
          float hedgerow = 1.0 - smoothstep(0.015, 0.048, borderDist);
          parcelColor = mix(parcelColor, vec3(0.11, 0.21, 0.09), hedgerow * 0.72);

          // Blend patchwork farmland in flat central valley, natural forest & meadow on hills
          float farmlandMask = (1.0 - smoothstep(42.0, 115.0, h)) * (1.0 - smoothstep(0.04, 0.15, slope)) * smoothstep(6.0, 15.0, h);
          vec3 hillGrass = mix(vec3(0.16, 0.32, 0.14), vec3(0.27, 0.41, 0.19), macroVar);
          vec3 deepForest = vec3(0.10, 0.23, 0.11);
          vec3 landColor = mix(mix(hillGrass, deepForest, smoothstep(90.0, 360.0, h) * 0.65), parcelColor, farmlandMask * 0.86);

          // Winding valley country road
          float roadCenter = 215.0 + sin(wp.y * 0.00072 + 1.4) * 165.0;
          float roadDist = abs(wp.x - roadCenter);
          if (h > 4.0 && h < 95.0 && wp.y > -6200.0 && wp.y < 2600.0) {
            float roadMask = 1.0 - smoothstep(4.5, 7.5, roadDist);
            landColor = mix(landColor, vec3(0.36, 0.35, 0.33), roadMask * 0.9);
          }

          // Sandy shoreline & wet riverbed near water level (y = 0)
          float beachMask = 1.0 - smoothstep(1.2, 8.5, h);
          vec3 sandColor = mix(vec3(0.62, 0.56, 0.43), vec3(0.76, 0.71, 0.57), detailVar);
          landColor = mix(landColor, sandColor, beachMask * (1.0 - smoothstep(0.25, 0.5, slope)));

          // Stratified mountain cliff rock on steep slopes & high altitudes
          float rockMask = smoothstep(0.22, 0.46, slope + max(0.0, h - 380.0) * 0.00045);
          float strata = tnoise(vec2(wp.x * 0.008, h * 0.055));
          vec3 rockCol = mix(vec3(0.31, 0.29, 0.27), vec3(0.46, 0.43, 0.40), strata * 0.7 + microVar * 0.3);
          landColor = mix(landColor, rockCol, clamp(rockMask, 0.0, 1.0));

          // Snow-capped distant alpine peaks!
          float snowHeightMask = smoothstep(560.0, 780.0, h + macroVar * 90.0);
          float snowSlopeKeep = 1.0 - smoothstep(0.42, 0.72, slope);
          float snowMask = clamp(snowHeightMask * (0.35 + 0.65 * snowSlopeKeep), 0.0, 1.0);
          vec3 snowCol = vec3(0.94, 0.96, 0.99) * (0.94 + 0.06 * microVar);
          landColor = mix(landColor, snowCol, snowMask);

          // Subtle micro surface variation
          landColor *= 0.92 + 0.16 * detailVar * (1.0 - snowMask * 0.6);

          // Moving soft cloud shadows across valleys & hills!
          vec2 shadowUv = (wp - uCloudDrift) * 0.00055;
          float cloudShadow = smoothstep(0.46, 0.74, tfbm(shadowUv));
          landColor *= 1.0 - cloudShadow * 0.28;

          diffuseColor.rgb *= landColor;
          `
        );
    };

    return mat;
  }

  private createOceanMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.shaderUniforms.uTime,
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, -0.5) },
        uSunColor: { value: new THREE.Color('#fff9ed') },
        uSkyHorizon: { value: new THREE.Color('#7cb4e8') },
        uSkyZenith: { value: new THREE.Color('#0c2f6b') },
        uFogColor: { value: new THREE.Color('#86b9e8') },
        uFogDensity: { value: 0.000095 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        varying float vViewDist;
        void main() {
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
        varying float vViewDist;

        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyHorizon;
        uniform vec3 uSkyZenith;
        uniform vec3 uFogColor;
        uniform float uFogDensity;

        float whash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
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
          vec2 uv1 = vWorldPos.xz * 0.022 + vec2(uTime * 0.35, -uTime * 0.22);
          vec2 uv2 = vWorldPos.xz * 0.058 + vec2(-uTime * 0.28, uTime * 0.41);
          float w1 = wnoise(uv1);
          float w2 = wnoise(uv2);

          // Perturbed water surface normal
          vec3 N = normalize(vec3((w1 - 0.5) * 0.14 + (w2 - 0.5) * 0.09, 1.0, (w2 - 0.5) * 0.14 - (w1 - 0.5) * 0.08));
          vec3 V = normalize(cameraPosition - vWorldPos);

          float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
          vec3 deepWater = vec3(0.04, 0.18, 0.34);
          vec3 shallowTint = vec3(0.08, 0.34, 0.46);
          vec3 reflSky = mix(uSkyZenith, uSkyHorizon, 0.65);

          vec3 waterCol = mix(mix(deepWater, shallowTint, w1 * 0.35), reflSky, clamp(0.15 + fresnel * 0.78, 0.0, 0.92));

          // Sun / Moon specular water shimmer
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 220.0) * 1.45 + pow(max(dot(N, H), 0.0), 32.0) * 0.18;
          waterCol += uSunColor * spec;

          float fog = 1.0 - exp(-pow(vViewDist * uFogDensity, 2.0));
          waterCol = mix(waterCol, uFogColor, clamp(fog, 0.0, 1.0));

          gl_FragColor = vec4(waterCol, 1.0);
        }
      `,
    });
  }

  private buildAirport(): void {
    const cx = this.airport.runwayCenter.x;
    const cz = this.airport.runwayCenter.z;
    const cy = this.airport.elevation;
    const rwLen = this.airport.runwayLength;
    const rwWid = this.airport.runwayWidth;

    // Graded grass/apron shoulder pad
    const apronGeo = new THREE.PlaneGeometry(rwWid + 86, rwLen + 110);
    apronGeo.rotateX(-Math.PI / 2);
    const apronMat = new THREE.MeshStandardMaterial({
      color: 0x3b4a33,
      roughness: 0.95,
    });
    const apron = new THREE.Mesh(apronGeo, apronMat);
    apron.position.set(cx + 18, cy + 0.05, cz);
    apron.receiveShadow = true;
    this.airportGroup.add(apron);

    // Procedural high-detail Runway Asphalt Texture (centerline, piano keys, numbers, aiming points)
    const rCanvas = document.createElement('canvas');
    rCanvas.width = 256;
    rCanvas.height = 2048;
    const ctx = rCanvas.getContext('2d')!;
    ctx.fillStyle = '#2b2e33';
    ctx.fillRect(0, 0, 256, 2048);

    // Subtle asphalt grain & tire touchdown marks
    for (let i = 0; i < 2400; i++) {
      const gx = (i * 73) % 256;
      const gy = (i * 197) % 2048;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)';
      ctx.fillRect(gx, gy, 3, 4);
    }

    // Side edge stripes
    ctx.fillStyle = '#e8edf2';
    ctx.fillRect(12, 30, 5, 1988);
    ctx.fillRect(239, 30, 5, 1988);

    // Threshold piano keys (North & South ends)
    for (let k = 0; k < 6; k++) {
      const lx = 32 + k * 14;
      const rx = 148 + k * 14;
      ctx.fillRect(lx, 42, 8, 72);
      ctx.fillRect(rx, 42, 8, 72);
      ctx.fillRect(lx, 1934, 8, 72);
      ctx.fillRect(rx, 1934, 8, 72);
    }

    // Aiming point blocks
    ctx.fillRect(48, 310, 28, 110);
    ctx.fillRect(180, 310, 28, 110);
    ctx.fillRect(48, 1628, 28, 110);
    ctx.fillRect(180, 1628, 28, 110);

    // Centerline dashes
    for (let y = 180; y < 1860; y += 76) {
      ctx.fillRect(124, y, 8, 42);
    }

    const rTex = new THREE.CanvasTexture(rCanvas);
    rTex.anisotropy = 4;
    const runwayGeo = new THREE.PlaneGeometry(rwWid, rwLen);
    runwayGeo.rotateX(-Math.PI / 2);
    const runwayMat = new THREE.MeshStandardMaterial({
      map: rTex,
      roughness: 0.82,
      metalness: 0.05,
    });
    const runwayMesh = new THREE.Mesh(runwayGeo, runwayMat);
    runwayMesh.position.set(cx, cy + 0.14, cz);
    runwayMesh.receiveShadow = true;
    this.airportGroup.add(runwayMesh);

    // Parallel taxiway + terminal tarmac on East side of runway
    const taxiGeo = new THREE.PlaneGeometry(42, 420);
    taxiGeo.rotateX(-Math.PI / 2);
    const taxiMat = new THREE.MeshStandardMaterial({ color: 0x34383e, roughness: 0.86 });
    const tarmac = new THREE.Mesh(taxiGeo, taxiMat);
    tarmac.position.set(cx + 46, cy + 0.11, cz + 40);
    tarmac.receiveShadow = true;
    this.airportGroup.add(tarmac);

    // Hangars & Control Tower
    const hangarMat = new THREE.MeshStandardMaterial({ color: 0xdbe2ea, roughness: 0.55, metalness: 0.25 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2c4c6e, roughness: 0.5, metalness: 0.3 });

    for (let h = 0; h < 2; h++) {
      const hangar = new THREE.Mesh(new THREE.BoxGeometry(24, 9, 30), hangarMat);
      hangar.position.set(cx + 68, cy + 4.5, cz - 20 + h * 48);
      hangar.castShadow = true;
      hangar.receiveShadow = true;
      this.airportGroup.add(hangar);

      const hRoof = new THREE.Mesh(new THREE.CylinderGeometry(12.4, 12.4, 30.4, 16, 1, false, 0, Math.PI), roofMat);
      hRoof.rotation.z = Math.PI / 2;
      hRoof.rotation.y = Math.PI / 2;
      hRoof.position.set(cx + 68, cy + 9.0, cz - 20 + h * 48);
      this.airportGroup.add(hRoof);
    }

    // Control Tower
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

    this.beaconLightObj.position.set(cx + 66, cy + 29, cz + 92);
    this.airportGroup.add(this.beaconLightObj);

    // Runway Edge Lights + PAPI glidepath lights
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
  }

  public rebuildTerrainAndScenery(): void {
    if (this.terrainMesh) {
      this.group.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      this.terrainMesh = null;
    }
    if (this.treeTrunksMesh) {
      this.group.remove(this.treeTrunksMesh);
      this.treeTrunksMesh.geometry.dispose();
      this.treeTrunksMesh = null;
    }
    if (this.treeCanopyMesh) {
      this.group.remove(this.treeCanopyMesh);
      this.treeCanopyMesh.geometry.dispose();
      this.treeCanopyMesh = null;
    }
    if (this.settlementWallsMesh) {
      this.group.remove(this.settlementWallsMesh);
      this.settlementWallsMesh.geometry.dispose();
      this.settlementWallsMesh = null;
    }
    if (this.settlementRoofsMesh) {
      this.group.remove(this.settlementRoofsMesh);
      this.settlementRoofsMesh.geometry.dispose();
      this.settlementRoofsMesh = null;
    }

    const segs = this.currentQuality.terrainSegments;
    const geo = new THREE.PlaneGeometry(this.terrainSize, this.terrainSize, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i) - 1800; // Shift terrain center northward along main flight canyon
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
    const trunkGeo = new THREE.CylinderGeometry(0.45, 0.7, 3.5, 5);
    trunkGeo.translate(0, 1.75, 0);
    const canopyGeo = new THREE.ConeGeometry(3.8, 10.5, 6);
    canopyGeo.translate(0, 7.6, 0);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3828, roughness: 0.95 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86 });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, maxTrees);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, maxTrees);
    canopies.castShadow = false;
    canopies.receiveShadow = this.currentQuality.shadowsEnabled;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let placed = 0;
    let attempts = 0;

    while (placed < maxTrees && attempts < maxTrees * 4) {
      attempts++;
      const r1 = hash2(attempts, 811);
      const r2 = hash2(attempts, 812);
      const r3 = hash2(attempts, 813);

      const x = (r1 - 0.5) * 14500;
      const z = (r2 - 0.58) * 14500;

      // Keep airport & approach zone clear
      if (Math.abs(x) < 260 && z > 850 && z < 2500) continue;

      const y = this.getTerrainHeight(x, z);
      if (y < 9.5 || y > 490) continue;

      // Avoid river & road
      if (Math.abs(x - this.riverCenterX(z)) < 58) continue;
      if (Math.abs(x - this.roadCenterX(z)) < 24) continue;

      // Prefer forested hills (y > 48m) or sparse hedgerow clusters in valley
      const densityChance = y > 52 ? 0.85 : 0.22;
      if (noise2D(x * 0.003, z * 0.003) + densityChance < 0.42) continue;

      const scale = 0.85 + r3 * 1.15;
      dummy.position.set(x, y - 0.3, z);
      dummy.rotation.set(0, r1 * Math.PI * 2, 0);
      dummy.scale.set(scale, scale * (0.9 + 0.3 * r2), scale);
      dummy.updateMatrix();

      trunks.setMatrixAt(placed, dummy.matrix);
      canopies.setMatrixAt(placed, dummy.matrix);

      // Rich natural variation of pine, cypress, and broadleaf greens
      color.setHSL(0.28 + (r3 - 0.5) * 0.06, 0.42 + r2 * 0.16, 0.16 + r1 * 0.11);
      canopies.setColorAt(placed, color);

      placed++;
    }

    trunks.count = placed;
    canopies.count = placed;
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;

    this.treeTrunksMesh = trunks;
    this.treeCanopyMesh = canopies;
    this.group.add(trunks);
    this.group.add(canopies);
  }

  private buildInstancedSettlements(): void {
    // Cozy scenic villages nestled along the valley road & lakeside
    const hubs: Array<[number, number]> = [
      [260, -420],
      [-340, -1850],
      [290, -3200],
      [140, -4550],
      [-1250, -2900],
    ];

    const maxBuildings = this.currentQuality.buildingCount;
    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    wallGeo.translate(0, 0.5, 0);
    const roofGeo = new THREE.ConeGeometry(0.82, 0.55, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.translate(0, 1.27, 0);

    const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
    const walls = new THREE.InstancedMesh(wallGeo, this.settlementWallMat, maxBuildings);
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, maxBuildings);

    const dummy = new THREE.Object3D();
    const roofCol = new THREE.Color();
    let placed = 0;

    for (let i = 0; i < maxBuildings * 2 && placed < maxBuildings; i++) {
      const hub = hubs[i % hubs.length];
      const r1 = hash2(i, 901);
      const r2 = hash2(i, 902);
      const r3 = hash2(i, 903);

      const ang = r1 * Math.PI * 2;
      const rad = 35 + Math.sqrt(r2) * 280;
      const x = hub[0] + Math.cos(ang) * rad;
      const z = hub[1] + Math.sin(ang) * rad;

      if (Math.abs(x - this.riverCenterX(z)) < 55) continue;
      if (Math.abs(x - this.roadCenterX(z)) < 16) continue;

      const y = this.getTerrainHeight(x, z);
      if (y < 10 || y > 135) continue;

      const w = 9 + r1 * 8;
      const h = 5.5 + r3 * 5.5;
      const d = 9 + r2 * 9;

      dummy.position.set(x, y - 0.4, z);
      dummy.rotation.set(0, r3 * Math.PI, 0);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();

      walls.setMatrixAt(placed, dummy.matrix);
      roofs.setMatrixAt(placed, dummy.matrix);

      // Terracotta, slate blue-grey, or warm brown roofs
      if (r1 < 0.55) roofCol.setHex(0x9a4b38);
      else if (r1 < 0.82) roofCol.setHex(0x475569);
      else roofCol.setHex(0x6b4f3b);
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
    this.group.add(walls);
    this.group.add(roofs);
  }

  public applyPreset(preset: AtmospherePreset, sunDir: THREE.Vector3): void {
    const ou = this.oceanMat.uniforms;
    ou.uSunDir.value.copy(sunDir);
    ou.uSunColor.value.copy(preset.sunColor);
    ou.uSkyHorizon.value.copy(preset.skyHorizon);
    ou.uSkyZenith.value.copy(preset.skyZenith);
    ou.uFogColor.value.copy(preset.fogColor);
    ou.uFogDensity.value = preset.fogDensity;

    this.shaderUniforms.uNightLights.value = preset.nightLights;
    this.settlementWallMat.emissiveIntensity = preset.nightLights * 0.28;
    this.beaconLightObj.intensity = 0.6 + preset.nightLights * 3.5;
    this.runwayLightMat.color.setHex(preset.nightLights > 0.3 ? 0xffe6a3 : 0xdde6ee);
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

    // Keep far ocean & outer skirt centered smoothly near aircraft
    this.oceanMesh.position.x = Math.round(focusPos.x / 500) * 500;
    this.oceanMesh.position.z = Math.round(focusPos.z / 500) * 500;
  }

  public dispose(): void {
    if (this.terrainMesh) this.terrainMesh.geometry.dispose();
    this.outerSkirtMesh.geometry.dispose();
    this.oceanMesh.geometry.dispose();
    if (this.treeTrunksMesh) this.treeTrunksMesh.geometry.dispose();
    if (this.treeCanopyMesh) this.treeCanopyMesh.geometry.dispose();
    if (this.settlementWallsMesh) this.settlementWallsMesh.geometry.dispose();
    if (this.settlementRoofsMesh) this.settlementRoofsMesh.geometry.dispose();
    this.terrainMat.dispose();
    this.oceanMat.dispose();
    this.settlementWallMat.dispose();
    this.runwayLightMat.dispose();
  }
}
