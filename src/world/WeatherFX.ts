import * as THREE from 'three';
import { WeatherConfig } from '../types';

/**
 * Dynamic 3D Weather Particle System:
 * - Crisp silver rain streaks in Rain Shower weather
 * - Floating sunlit valley pollen / meadow petals in Meadow Breeze weather
 * - Zero per-frame heap allocations!
 */
export class WeatherFX {
  public readonly group = new THREE.Group();

  private rainMesh: THREE.InstancedMesh;
  private rainMat: THREE.MeshBasicMaterial;
  private rainCount = 420;
  private rainOffsets: Float32Array;
  private rainSpeeds: Float32Array;

  private petalMesh: THREE.InstancedMesh;
  private petalMat: THREE.MeshBasicMaterial;
  private petalCount = 160;
  private petalOffsets: Float32Array;
  private petalPhases: Float32Array;

  private rainIntensity = 0;
  private petalIntensity = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    // 1. Slanted 3D Rain Streaks
    const rainGeo = new THREE.CylinderGeometry(0.035, 0.02, 4.6, 4);
    this.rainMat = new THREE.MeshBasicMaterial({
      color: 0xd8ecff,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.rainMesh = new THREE.InstancedMesh(rainGeo, this.rainMat, this.rainCount);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;

    this.rainOffsets = new Float32Array(this.rainCount * 3);
    this.rainSpeeds = new Float32Array(this.rainCount);
    for (let i = 0; i < this.rainCount; i++) {
      this.rainOffsets[i * 3 + 0] = (Math.random() - 0.5) * 120;
      this.rainOffsets[i * 3 + 1] = (Math.random() - 0.5) * 70;
      this.rainOffsets[i * 3 + 2] = (Math.random() - 0.5) * 120;
      this.rainSpeeds[i] = 58 + Math.random() * 26;
    }
    this.group.add(this.rainMesh);

    // 2. Warm Sunlit Valley Breeze Motes / Blossoms
    const petalGeo = new THREE.PlaneGeometry(0.45, 0.28);
    this.petalMat = new THREE.MeshBasicMaterial({
      color: 0xfff6d6,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.petalMesh = new THREE.InstancedMesh(petalGeo, this.petalMat, this.petalCount);
    this.petalMesh.frustumCulled = false;
    this.petalMesh.visible = false;

    this.petalOffsets = new Float32Array(this.petalCount * 3);
    this.petalPhases = new Float32Array(this.petalCount);
    for (let i = 0; i < this.petalCount; i++) {
      this.petalOffsets[i * 3 + 0] = (Math.random() - 0.5) * 95;
      this.petalOffsets[i * 3 + 1] = (Math.random() - 0.5) * 45;
      this.petalOffsets[i * 3 + 2] = (Math.random() - 0.5) * 95;
      this.petalPhases[i] = Math.random() * Math.PI * 2;
    }
    this.group.add(this.petalMesh);

    scene.add(this.group);
  }

  public applyWeather(weather: WeatherConfig): void {
    this.rainIntensity = weather.rainIntensity;
    this.petalIntensity = weather.petalIntensity;
    this.rainMesh.visible = this.rainIntensity > 0.02;
    this.petalMesh.visible = this.petalIntensity > 0.02;
    this.rainMat.opacity = 0.42 * this.rainIntensity;
    this.petalMat.opacity = 0.68 * this.petalIntensity;
  }

  public update(dt: number, elapsed: number, focusPos: THREE.Vector3, aircraftVel: THREE.Vector3): void {
    if (this.rainMesh.visible) {
      for (let i = 0; i < this.rainCount; i++) {
        let ox = this.rainOffsets[i * 3 + 0] - (aircraftVel.x * 0.25 - 6.0) * dt;
        let oy = this.rainOffsets[i * 3 + 1] - this.rainSpeeds[i] * dt;
        let oz = this.rainOffsets[i * 3 + 2] - aircraftVel.z * 0.25 * dt;

        if (oy < -35) oy += 70;
        if (ox < -60) ox += 120;
        if (ox > 60) ox -= 120;
        if (oz < -60) oz += 120;
        if (oz > 60) oz -= 120;

        this.rainOffsets[i * 3 + 0] = ox;
        this.rainOffsets[i * 3 + 1] = oy;
        this.rainOffsets[i * 3 + 2] = oz;

        this.dummy.position.set(focusPos.x + ox, focusPos.y + oy, focusPos.z + oz);
        this.dummy.rotation.set(0.14, 0, -0.1);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.rainMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.rainMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.petalMesh.visible) {
      for (let i = 0; i < this.petalCount; i++) {
        const ph = this.petalPhases[i];
        let ox = this.petalOffsets[i * 3 + 0] + (Math.sin(elapsed * 1.4 + ph) * 3.5 - aircraftVel.x * 0.12) * dt;
        let oy = this.petalOffsets[i * 3 + 1] + Math.cos(elapsed * 1.1 + ph) * 1.6 * dt;
        let oz = this.petalOffsets[i * 3 + 2] - aircraftVel.z * 0.12 * dt;

        if (ox < -48) ox += 96;
        if (ox > 48) ox -= 96;
        if (oy < -22) oy += 44;
        if (oy > 22) oy -= 44;
        if (oz < -48) oz += 96;
        if (oz > 48) oz -= 96;

        this.petalOffsets[i * 3 + 0] = ox;
        this.petalOffsets[i * 3 + 1] = oy;
        this.petalOffsets[i * 3 + 2] = oz;

        this.dummy.position.set(focusPos.x + ox, focusPos.y + oy, focusPos.z + oz);
        this.dummy.rotation.set(elapsed * 1.5 + ph, elapsed * 1.1, ph);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.petalMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.petalMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
