import * as THREE from 'three';

export type AtmospherePresetId =
  | 'afternoon_moon'
  | 'morning'
  | 'golden_hour'
  | 'sunset'
  | 'blue_hour';

export type GraphicsPresetId = 'low' | 'medium' | 'high' | 'ultra';

export type FlightModeId = 'relaxed' | 'simulation';

export type GameplayModeId =
  | 'free_flight'
  | 'scenic_journey'
  | 'cloud_exploration'
  | 'landing_challenge';

export type CameraModeId = 'chase' | 'cockpit' | 'cinematic' | 'freelook';

export type HudModeId = 'full' | 'minimal' | 'immersive';

export type AircraftVariantId = 'cloudrunner' | 'skyhawk' | 'albatross';

export interface AircraftSpec {
  id: AircraftVariantId;
  name: string;
  subtitle: string;
  description: string;
  cruiseSpeedKts: number;
  maxSpeedKts: number;
  stallSpeedKts: number;
  rollRate: number;
  pitchRate: number;
  yawRate: number;
  liftFactor: number;
  wingSpan: number;
  accentColor: string;
}

export interface AtmospherePreset {
  id: AtmospherePresetId;
  name: string;
  subtitle: string;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  moonElevationDeg: number;
  moonAzimuthDeg: number;
  moonVisibility: number; // 0..1
  starVisibility: number; // 0..1
  skyZenith: THREE.Color;
  skyUpper: THREE.Color;
  skyHorizon: THREE.Color;
  skyGroundBounce: THREE.Color;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSkyColor: THREE.Color;
  hemiGroundColor: THREE.Color;
  hemiIntensity: number;
  cloudBrightColor: THREE.Color;
  cloudMidColor: THREE.Color;
  cloudShadowColor: THREE.Color;
  cloudRimColor: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  exposure: number;
  nightLights: number; // 0..1 for runway & settlement lights
}

export interface GraphicsConfig {
  id: GraphicsPresetId;
  label: string;
  maxDpr: number;
  adaptiveResolution: boolean;
  shadowsEnabled: boolean;
  shadowMapSize: number;
  cloudClusterCount: number;
  cloudLobesPerCluster: number;
  skyRaymarchSteps: number;
  terrainSegments: number;
  drawDistance: number;
  treeCount: number;
  buildingCount: number;
  mistParticles: number;
}

export interface FlightAssistOptions {
  flightMode: FlightModeId;
  altitudeAssist: boolean;
  collisionDamage: boolean;
  stallSimulation: boolean;
}

export interface ControllerMapping {
  pitchAxis: number;
  rollAxis: number;
  yawAxis: number;
  throttleUpBtn: number;
  throttleDownBtn: number;
  cameraBtn: number;
  gearBtn: number;
  airbrakeBtn: number;
  resetBtn: number;
  pauseBtn: number;
}

export interface ControllerSettings {
  deadzone: number;
  sensitivity: number;
  invertPitch: boolean;
  axisCenterOffsets: [number, number, number, number];
  mapping: ControllerMapping;
}

export interface AudioSettings {
  masterEnabled: boolean;
  engineVolume: number;
  ambientVolume: number;
  musicVolume: number;
  musicMuted: boolean;
}

export interface ControlInputs {
  pitch: number; // -1..1 (positive = nose up)
  roll: number; // -1..1 (positive = bank right)
  yaw: number; // -1..1 (positive = yaw right)
  throttleDelta: number; // -1..1 continuous change
  throttleDirect: number | null; // 0..1 when slider dragged
  airbrake: boolean;
  toggleGear: boolean;
  switchCamera: boolean;
  resetAircraft: boolean;
  togglePause: boolean;
  lookDeltaX: number;
  lookDeltaY: number;
  activeSource: 'keyboard' | 'gamepad' | 'touch';
}

export interface FlightTelemetry {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  forward: THREE.Vector3;
  up: THREE.Vector3;
  airspeedMs: number;
  airspeedKts: number;
  altitudeM: number;
  altitudeFt: number;
  aglM: number;
  verticalSpeedFpm: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  throttle: number; // 0..1
  rpmNormalized: number; // 0..1
  gearDown: boolean;
  gearDeployAnim: number; // 0..1
  airbrakeActive: boolean;
  airbrakeAnim: number; // 0..1
  onGround: boolean;
  stalling: boolean;
  crashed: boolean;
  cloudDensity: number; // 0..1 inside cloud
  gForce: number;
  aileronInput: number;
  elevatorInput: number;
  rudderInput: number;
}
