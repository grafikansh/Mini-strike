import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA_CEILING_Y, ARENA_COLLIDERS } from './arena';
import type { EnemyPolicy } from './types';

function makeGridTexture(bg: string, line: string, size = 64, step = 16): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i + 0.5);
    ctx.lineTo(size, i + 0.5);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function addBoxGeo(
  list: THREE.BufferGeometry[],
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  uvScale = 1
): void {
  const g = new THREE.BoxGeometry(w, h, d);
  if (uvScale !== 1 && g.attributes.uv) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale);
    }
  }
  g.translate(x, y, z);
  list.push(g);
}

export interface ArenaResources {
  group: THREE.Group;
  dispose: () => void;
}

export function buildArenaMeshes(): ArenaResources {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Floor (single merged quad, repeated 64x64 grid)
  const floorTex = makeGridTexture('#1c2430', '#273242', 64, 32);
  floorTex.repeat.set(26, 20);
  disposables.push(floorTex);

  const floorGeo = new THREE.PlaneGeometry(50, 38);
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(0, 0, -4);
  const floorMat = new THREE.MeshLambertMaterial({ map: floorTex });
  disposables.push(floorGeo, floorMat);
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  group.add(floorMesh);

  // 2. Ceiling (single merged slate plane + emissive light panels)
  const ceilTex = makeGridTexture('#232d3b', '#2c394b', 64, 32);
  ceilTex.repeat.set(26, 20);
  disposables.push(ceilTex);

  const ceilGeo = new THREE.PlaneGeometry(50, 38);
  ceilGeo.rotateX(Math.PI / 2);
  ceilGeo.translate(0, ARENA_CEILING_Y, -4);
  const ceilMat = new THREE.MeshLambertMaterial({ map: ceilTex });
  disposables.push(ceilGeo, ceilMat);
  group.add(new THREE.Mesh(ceilGeo, ceilMat));

  // Emissive ceiling strips (1 draw call) for clear room orientation
  const stripGeos: THREE.BufferGeometry[] = [];
  const stripPositions: Array<[number, number, number, number]> = [
    [0, 3, 4.5, 0.7],     // Central Hall
    [0, -15, 5.0, 0.7],   // North Chamber
    [-18, -1, 0.7, 5.0],  // West Wing
    [-18, -14, 0.7, 5.0], // West Wing N
    [18, -1, 0.7, 5.0],   // East Wing
    [18, -14, 0.7, 5.0],  // East Wing N
  ];
  for (const [sx, sz, sw, sd] of stripPositions) {
    addBoxGeo(stripGeos, sw, 0.08, sd, sx, ARENA_CEILING_Y - 0.04, sz);
  }
  const mergedStrips = mergeGeometries(stripGeos);
  stripGeos.forEach((g) => g.dispose());
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xbae6fd });
  disposables.push(mergedStrips, stripMat);
  group.add(new THREE.Mesh(mergedStrips, stripMat));

  // 3. Walls & Cover (merged into 2 draw calls total!)
  const wallGeos: THREE.BufferGeometry[] = [];
  const coverGeos: THREE.BufferGeometry[] = [];

  for (let i = 0; i < ARENA_COLLIDERS.length; i++) {
    const b = ARENA_COLLIDERS[i];
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) * 0.5;
    const cz = (b.minZ + b.maxZ) * 0.5;
    const cy = b.height * 0.5;
    if (b.kind === 'wall') {
      addBoxGeo(wallGeos, w, b.height, d, cx, cy, cz, Math.max(1, Math.round(Math.max(w, d) / 4)));
    } else {
      addBoxGeo(coverGeos, w, b.height, d, cx, cy, cz);
    }
  }

  const wallTex = makeGridTexture('#3e4c5e', '#2f3b4a', 64, 32);
  disposables.push(wallTex);
  const mergedWalls = mergeGeometries(wallGeos);
  wallGeos.forEach((g) => g.dispose());
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
  disposables.push(mergedWalls, wallMat);
  group.add(new THREE.Mesh(mergedWalls, wallMat));

  const mergedCover = mergeGeometries(coverGeos);
  coverGeos.forEach((g) => g.dispose());
  const coverMat = new THREE.MeshLambertMaterial({ color: 0x786850 });
  disposables.push(mergedCover, coverMat);
  group.add(new THREE.Mesh(mergedCover, coverMat));

  return {
    group,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export interface Mp5Viewmodel {
  root: THREE.Group;
  gunPivot: THREE.Group;
  muzzleFlash: THREE.Mesh;
  muzzleTipLocal: THREE.Vector3;
  dispose: () => void;
}

/**
 * First-person MP5-style arcade weapon + player hands only (no player body).
 * Assembled as a composite 12-part THREE.Group.
 */
export function buildMp5Viewmodel(): Mp5Viewmodel {
  const root = new THREE.Group();
  const gunPivot = new THREE.Group();
  // Positioned cleanly in lower-right FPS framing
  gunPivot.position.set(0.23, -0.21, -0.42);
  root.add(gunPivot);

  const disposables: Array<{ dispose: () => void }> = [];

  const metalMat = new THREE.MeshLambertMaterial({ color: 0x262d38 });
  const polymerMat = new THREE.MeshLambertMaterial({ color: 0x161a22 });
  const accentMetalMat = new THREE.MeshLambertMaterial({ color: 0x4b5563 });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xd19c78 });
  const gloveMat = new THREE.MeshLambertMaterial({ color: 0x2b333d });
  const sleeveMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  disposables.push(metalMat, polymerMat, accentMetalMat, skinMat, gloveMat, sleeveMat, flashMat);

  const addPart = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0
  ) => {
    disposables.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    gunPivot.add(m);
    return m;
  };

  // 1. Upper receiver
  addPart(new THREE.BoxGeometry(0.056, 0.068, 0.34), metalMat, 0, 0.02, -0.02);
  // 2. Lower receiver
  addPart(new THREE.BoxGeometry(0.05, 0.044, 0.19), polymerMat, 0, -0.028, 0.03);
  // 3. Ribbed tropical handguard
  addPart(new THREE.BoxGeometry(0.054, 0.058, 0.16), polymerMat, 0, 0.005, -0.23);
  // 4. Cocking tube above handguard
  addPart(new THREE.CylinderGeometry(0.013, 0.013, 0.18, 6), metalMat, 0, 0.048, -0.22, Math.PI / 2);
  // 5. Barrel + muzzle lug
  addPart(new THREE.CylinderGeometry(0.011, 0.011, 0.14, 6), accentMetalMat, 0, 0.012, -0.37, Math.PI / 2);
  // 6. Front hooded sight
  addPart(new THREE.BoxGeometry(0.022, 0.032, 0.02), accentMetalMat, 0, 0.068, -0.30);
  // 7. Rear drum sight
  addPart(new THREE.CylinderGeometry(0.014, 0.014, 0.022, 6), accentMetalMat, 0, 0.062, 0.06, Math.PI / 2);
  // 8. Pistol grip
  addPart(new THREE.BoxGeometry(0.04, 0.11, 0.048), polymerMat, 0, -0.088, 0.09, 0.25);
  // 9. Curved MP5 magazine (two angled segments)
  addPart(new THREE.BoxGeometry(0.028, 0.105, 0.042), metalMat, 0, -0.09, -0.085, -0.18);
  addPart(new THREE.BoxGeometry(0.026, 0.075, 0.04), metalMat, 0, -0.165, -0.102, -0.34);
  // 10. Collapsed stock endcap
  addPart(new THREE.BoxGeometry(0.052, 0.075, 0.05), polymerMat, 0, 0.006, 0.16);

  // 11. Right hand + tactical sleeve (grip)
  addPart(new THREE.BoxGeometry(0.058, 0.064, 0.075), gloveMat, 0.008, -0.075, 0.095, 0.2);
  addPart(new THREE.BoxGeometry(0.066, 0.066, 0.22), sleeveMat, 0.042, -0.115, 0.23, 0.12, -0.15, 0);

  // 12. Left hand + wrist + sleeve (support hand under handguard)
  addPart(new THREE.BoxGeometry(0.064, 0.054, 0.082), gloveMat, -0.018, -0.034, -0.22, 0.05, 0.18, 0);
  addPart(new THREE.BoxGeometry(0.056, 0.054, 0.10), skinMat, -0.055, -0.072, -0.14, 0.18, 0.36, 0.12);
  addPart(new THREE.BoxGeometry(0.068, 0.066, 0.22), sleeveMat, -0.11, -0.122, 0.01, 0.2, 0.42, 0.15);

  // Muzzle flash star (hidden by default)
  const flashGeo = new THREE.OctahedronGeometry(0.058, 0);
  flashGeo.scale(1.1, 1.1, 1.9);
  disposables.push(flashGeo);
  const muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
  muzzleFlash.position.set(0, 0.012, -0.46);
  muzzleFlash.visible = false;
  gunPivot.add(muzzleFlash);

  return {
    root,
    gunPivot,
    muzzleFlash,
    muzzleTipLocal: new THREE.Vector3(0.23, -0.198, -0.88),
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export interface EnemyVisual {
  group: THREE.Group;
  bodyMeshes: THREE.Mesh[];
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  baseColors: number[];
  dispose: () => void;
}

const SHARED_ENEMY_MATS_DISPOSE: Array<() => void> = [];

export function buildEnemyVisual(policy: EnemyPolicy): EnemyVisual {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const scale = policy === 'brute' ? 1.12 : policy === 'strafer' ? 0.96 : 1.0;
  const primaryHex = policy === 'brute' ? 0x6d28d9 : policy === 'strafer' ? 0xd97706 : 0xdc2626;
  const armorHex = policy === 'brute' ? 0x334155 : policy === 'strafer' ? 0x3f3f46 : 0x27272a;
  const visorHex = policy === 'brute' ? 0x38bdf8 : policy === 'strafer' ? 0xfef08a : 0xfca5a5;

  const primaryMat = new THREE.MeshLambertMaterial({ color: primaryHex });
  const armorMat = new THREE.MeshLambertMaterial({ color: armorHex });
  const visorMat = new THREE.MeshBasicMaterial({ color: visorHex });
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x05080d,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  disposables.push(primaryMat, armorMat, visorMat, shadowMat);

  // Soft contact ground disc (zero shadow-map cost)
  const shadowGeo = new THREE.CircleGeometry(0.55 * scale, 10);
  shadowGeo.rotateX(-Math.PI / 2);
  disposables.push(shadowGeo);
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.y = 0.015;
  group.add(shadowMesh);

  const bodyMeshes: THREE.Mesh[] = [];
  const baseColors: number[] = [];

  const mkPart = (
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    colorHex: number
  ) => {
    const geo = new THREE.BoxGeometry(w * scale, h * scale, d * scale);
    disposables.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x * scale, y * scale, z * scale);
    group.add(mesh);
    if (mat !== visorMat) {
      bodyMeshes.push(mesh);
      baseColors.push(colorHex);
    }
    return mesh;
  };

  // Grounded at y = 0: legs -> torso -> chestplate -> head -> visor -> arms
  const leftLeg = mkPart(0.2, 0.72, 0.22, armorMat, -0.15, 0.36, 0, armorHex);
  const rightLeg = mkPart(0.2, 0.72, 0.22, armorMat, 0.15, 0.36, 0, armorHex);
  mkPart(0.56, 0.68, 0.32, primaryMat, 0, 1.06, 0, primaryHex); // Torso
  mkPart(policy === 'brute' ? 0.66 : 0.48, 0.36, 0.36, armorMat, 0, 1.18, 0.02, armorHex); // Armor plate
  mkPart(0.36, 0.36, 0.36, primaryMat, 0, 1.6, 0, primaryHex); // Head
  mkPart(0.28, 0.1, 0.06, visorMat, 0, 1.62, 0.17, visorHex); // Glowing visor (+Z front)
  const leftArm = mkPart(0.18, 0.62, 0.18, primaryMat, -0.39, 1.08, 0.04, primaryHex);
  const rightArm = mkPart(0.18, 0.62, 0.18, primaryMat, 0.39, 1.08, 0.04, primaryHex);

  return {
    group,
    bodyMeshes,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    baseColors,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      SHARED_ENEMY_MATS_DISPOSE.forEach((fn) => fn());
    },
  };
}
