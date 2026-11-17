// Deterministic fast 2D & 3D gradient/value noise utilities for terrain, biomes, and cloud density fields

const PERM = new Uint8Array(512);
const GRAD3: ReadonlyArray<[number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

(function initSeed(seed = 20261118) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
  }
})();

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function noise2D(x: number, y: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = PERM[PERM[X] + Y] % 12;
  const ab = PERM[PERM[X] + Y + 1] % 12;
  const ba = PERM[PERM[X + 1] + Y] % 12;
  const bb = PERM[PERM[X + 1] + Y + 1] % 12;

  const gAA = GRAD3[aa][0] * xf + GRAD3[aa][1] * yf;
  const gBA = GRAD3[ba][0] * (xf - 1) + GRAD3[ba][1] * yf;
  const gAB = GRAD3[ab][0] * xf + GRAD3[ab][1] * (yf - 1);
  const gBB = GRAD3[bb][0] * (xf - 1) + GRAD3[bb][1] * (yf - 1);

  return lerp(lerp(gAA, gBA, u), lerp(gAB, gBB, u), v);
}

export function noise3D(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const zf = z - Math.floor(z);

  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);

  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;

  const g000 = GRAD3[PERM[AA] % 12];
  const g100 = GRAD3[PERM[BA] % 12];
  const g010 = GRAD3[PERM[AB] % 12];
  const g110 = GRAD3[PERM[BB] % 12];
  const g001 = GRAD3[PERM[AA + 1] % 12];
  const g101 = GRAD3[PERM[BA + 1] % 12];
  const g011 = GRAD3[PERM[AB + 1] % 12];
  const g111 = GRAD3[PERM[BB + 1] % 12];

  const n000 = g000[0] * xf + g000[1] * yf + g000[2] * zf;
  const n100 = g100[0] * (xf - 1) + g100[1] * yf + g100[2] * zf;
  const n010 = g010[0] * xf + g010[1] * (yf - 1) + g010[2] * zf;
  const n110 = g110[0] * (xf - 1) + g110[1] * (yf - 1) + g110[2] * zf;
  const n001 = g001[0] * xf + g001[1] * yf + g001[2] * (zf - 1);
  const n101 = g101[0] * (xf - 1) + g101[1] * yf + g101[2] * (zf - 1);
  const n011 = g011[0] * xf + g011[1] * (yf - 1) + g011[2] * (zf - 1);
  const n111 = g111[0] * (xf - 1) + g111[1] * (yf - 1) + g111[2] * (zf - 1);

  return lerp(
    lerp(lerp(n000, n100, u), lerp(n010, n110, u), v),
    lerp(lerp(n001, n101, u), lerp(n011, n111, u), v),
    w
  );
}

export function fbm2D(x: number, y: number, octaves = 5, lacunarity = 2.02, gain = 0.5): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2D(x * freq, y * freq);
    freq *= lacunarity;
    amp *= gain;
  }
  return sum;
}

export function ridged2D(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let prev = 1.0;
  for (let i = 0; i < octaves; i++) {
    let n = 1.0 - Math.abs(noise2D(x * freq, y * freq));
    n = n * n;
    sum += n * amp * prev;
    prev = clamp(n * 1.6, 0.25, 1.2);
    freq *= 2.12;
    amp *= 0.48;
  }
  return sum;
}

export function hash2(i: number, j: number): number {
  const n = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  const m = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((m ^ (m >>> 16)) >>> 0) / 4294967295;
}
