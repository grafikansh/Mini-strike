import type { BoxCollider, EnemyPolicy, EnemyState } from './types';

export const PLAYER_RADIUS = 0.48;
export const PLAYER_EYE_HEIGHT = 1.65;
export const PLAYER_HEIGHT = 1.85;
export const ARENA_CEILING_Y = 5.5;
export const MAX_ACTIVE_ENEMIES = 6;
export const INITIAL_ENEMY_COUNT = 2;

export const PLAYER_SPAWN = {
  x: 0,
  y: 0,
  z: 8,
  yaw: 0, // facing -Z toward North passage
  pitch: 0,
};

/**
 * 4 large connected indoor rooms:
 * - Central Hall:  x [-10, 10], z [-6, 14]
 * - North Chamber: x [-10, 10], z [-22, -8]
 * - West Wing:     x [-24, -12], z [-22, 14]
 * - East Wing:     x [12, 24], z [-22, 14]
 */
export const ARENA_COLLIDERS: readonly BoxCollider[] = [
  // Outer perimeter walls (height 5.5)
  { minX: -25, maxX: 25, minZ: -23, maxZ: -22, height: ARENA_CEILING_Y, kind: 'wall' }, // North
  { minX: -25, maxX: 25, minZ: 14, maxZ: 15, height: ARENA_CEILING_Y, kind: 'wall' },   // South
  { minX: -25, maxX: -24, minZ: -22, maxZ: 14, height: ARENA_CEILING_Y, kind: 'wall' }, // West
  { minX: 24, maxX: 25, minZ: -22, maxZ: 14, height: ARENA_CEILING_Y, kind: 'wall' },   // East

  // Divider: Central Hall <-> North Chamber (6m doorway at x in [-3, 3])
  { minX: -12, maxX: -3, minZ: -8, maxZ: -6, height: ARENA_CEILING_Y, kind: 'wall' },
  { minX: 3, maxX: 12, minZ: -8, maxZ: -6, height: ARENA_CEILING_Y, kind: 'wall' },

  // Divider: Central Hall <-> West Wing (5m doorway at z in [-2.5, 2.5])
  { minX: -12, maxX: -10, minZ: -6, maxZ: -2.5, height: ARENA_CEILING_Y, kind: 'wall' },
  { minX: -12, maxX: -10, minZ: 2.5, maxZ: 14, height: ARENA_CEILING_Y, kind: 'wall' },

  // Divider: Central Hall <-> East Wing (5m doorway at z in [-2.5, 2.5])
  { minX: 10, maxX: 12, minZ: -6, maxZ: -2.5, height: ARENA_CEILING_Y, kind: 'wall' },
  { minX: 10, maxX: 12, minZ: 2.5, maxZ: 14, height: ARENA_CEILING_Y, kind: 'wall' },

  // Divider: North Chamber <-> West Wing (5m doorway at z in [-17.5, -12.5])
  { minX: -12, maxX: -10, minZ: -22, maxZ: -17.5, height: ARENA_CEILING_Y, kind: 'wall' },
  { minX: -12, maxX: -10, minZ: -12.5, maxZ: -8, height: ARENA_CEILING_Y, kind: 'wall' },

  // Divider: North Chamber <-> East Wing (5m doorway at z in [-17.5, -12.5])
  { minX: 10, maxX: 12, minZ: -22, maxZ: -17.5, height: ARENA_CEILING_Y, kind: 'wall' },
  { minX: 10, maxX: 12, minZ: -12.5, maxZ: -8, height: ARENA_CEILING_Y, kind: 'wall' },

  // Tactical cover blocks inside the 4 rooms
  { minX: -5.6, maxX: -3.4, minZ: 0.9, maxZ: 3.1, height: 1.55, kind: 'cover' },
  { minX: 3.4, maxX: 5.6, minZ: 0.9, maxZ: 3.1, height: 1.55, kind: 'cover' },
  { minX: -5.5, maxX: -3.5, minZ: -16, maxZ: -14, height: ARENA_CEILING_Y, kind: 'cover' },
  { minX: 3.5, maxX: 5.5, minZ: -16, maxZ: -14, height: ARENA_CEILING_Y, kind: 'cover' },
  { minX: -19.2, maxX: -16.8, minZ: -9.2, maxZ: -6.8, height: 1.65, kind: 'cover' },
  { minX: -19.2, maxX: -16.8, minZ: 4.8, maxZ: 7.2, height: 1.65, kind: 'cover' },
  { minX: 16.8, maxX: 19.2, minZ: -9.2, maxZ: -6.8, height: 1.65, kind: 'cover' },
  { minX: 16.8, maxX: 19.2, minZ: 4.8, maxZ: 7.2, height: 1.65, kind: 'cover' },
];

export interface Waypoint {
  x: number;
  z: number;
}

// Doorway & room-center navigation nodes for lightweight shortest-path steering
export const NAV_NODES: readonly Waypoint[] = [
  { x: 0, z: 4 },     // 0: Central Hall center
  { x: 0, z: -7 },    // 1: Central <-> North doorway
  { x: 0, z: -15 },   // 2: North Chamber center
  { x: -11, z: 0 },   // 3: Central <-> West doorway
  { x: 11, z: 0 },    // 4: Central <-> East doorway
  { x: -11, z: -15 }, // 5: North <-> West doorway
  { x: 11, z: -15 },  // 6: North <-> East doorway
  { x: -18, z: 0 },   // 7: West Wing south-mid
  { x: -18, z: -15 }, // 8: West Wing north-mid
  { x: 18, z: 0 },    // 9: East Wing south-mid
  { x: 18, z: -15 },  // 10: East Wing north-mid
];

export const ENEMY_SPAWN_POINTS: readonly Waypoint[] = [
  { x: 0, z: -18 },
  { x: -7, z: -12 },
  { x: 7, z: -12 },
  { x: -18, z: -18 },
  { x: -18, z: -2 },
  { x: -18, z: 10 },
  { x: 18, z: -18 },
  { x: 18, z: -2 },
  { x: 18, z: 10 },
  { x: -7, z: 9 },
  { x: 7, z: 9 },
];

export function resolveCircleAABB(
  x: number,
  z: number,
  radius: number,
  colliders: readonly BoxCollider[] = ARENA_COLLIDERS
): { x: number; z: number } {
  let rx = x;
  let rz = z;

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      const closestX = rx < b.minX ? b.minX : rx > b.maxX ? b.maxX : rx;
      const closestZ = rz < b.minZ ? b.minZ : rz > b.maxZ ? b.maxZ : rz;
      const dx = rx - closestX;
      const dz = rz - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < radius * radius) {
        if (distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          const push = radius - dist;
          rx += (dx / dist) * push;
          rz += (dz / dist) * push;
        } else {
          // Center inside AABB: push out along nearest edge
          const left = rx - b.minX;
          const right = b.maxX - rx;
          const top = rz - b.minZ;
          const bottom = b.maxZ - rz;
          const minEdge = Math.min(left, right, top, bottom);
          if (minEdge === left) rx = b.minX - radius;
          else if (minEdge === right) rx = b.maxX + radius;
          else if (minEdge === top) rz = b.minZ - radius;
          else rz = b.maxZ + radius;
        }
      }
    }
  }

  return { x: rx, z: rz };
}

export function raycastBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  maxDist: number
): number {
  let tmin = 0;
  let tmax = maxDist;

  // X slab
  if (Math.abs(dx) < 1e-8) {
    if (ox < minX || ox > maxX) return -1;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - ox) * inv;
    let t2 = (maxX - ox) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  // Y slab
  if (Math.abs(dy) < 1e-8) {
    if (oy < minY || oy > maxY) return -1;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - oy) * inv;
    let t2 = (maxY - oy) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  // Z slab
  if (Math.abs(dz) < 1e-8) {
    if (oz < minZ || oz > maxZ) return -1;
  } else {
    const inv = 1 / dz;
    let t1 = (minZ - oz) * inv;
    let t2 = (maxZ - oz) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }

  return tmin >= 0 && tmin <= maxDist ? tmin : -1;
}

export function raycastArena(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDist: number,
  colliders: readonly BoxCollider[] = ARENA_COLLIDERS
): number {
  let closest = maxDist;

  // Floor & ceiling planes
  if (dy < -1e-6 && oy > 0) {
    const tFloor = -oy / dy;
    if (tFloor > 0 && tFloor < closest) closest = tFloor;
  } else if (dy > 1e-6 && oy < ARENA_CEILING_Y) {
    const tCeil = (ARENA_CEILING_Y - oy) / dy;
    if (tCeil > 0 && tCeil < closest) closest = tCeil;
  }

  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    const t = raycastBox(
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      b.minX,
      0,
      b.minZ,
      b.maxX,
      b.height,
      b.maxZ,
      closest
    );
    if (t >= 0 && t < closest) {
      closest = t;
    }
  }

  return closest;
}

export function hasLineOfSight2D(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  eyeY = 1.2,
  colliders: readonly BoxCollider[] = ARENA_COLLIDERS
): boolean {
  const vx = x2 - x1;
  const vz = z2 - z1;
  const dist = Math.hypot(vx, vz);
  if (dist < 1e-4) return true;
  const dx = vx / dist;
  const dz = vz / dist;
  const hitDist = raycastArena(x1, eyeY, z1, dx, 0, dz, dist, colliders);
  return hitDist >= dist - 0.05;
}

export interface ShotResult {
  hitWallDist: number;
  hitEnemy: EnemyState | null;
  hitDist: number;
  isHeadshot: boolean;
}

export function resolveHitscanShot(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  enemies: readonly EnemyState[],
  maxDist = 80,
  colliders: readonly BoxCollider[] = ARENA_COLLIDERS
): ShotResult {
  const wallDist = raycastArena(ox, oy, oz, dx, dy, dz, maxDist, colliders);
  let bestEnemy: EnemyState | null = null;
  let bestDist = wallDist;
  let isHeadshot = false;

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.active || e.koTimer > 0) continue;

    // Slightly generous arcade hitbox aligned to the low-poly body
    const r = e.radius * 1.1;
    const t = raycastBox(
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
      e.x - r,
      e.y,
      e.z - r,
      e.x + r,
      e.y + e.height,
      e.z + r,
      bestDist
    );

    if (t >= 0 && t < bestDist) {
      bestDist = t;
      bestEnemy = e;
      const hitY = oy + dy * t;
      isHeadshot = hitY >= e.y + e.height * 0.72;
    }
  }

  return {
    hitWallDist: wallDist,
    hitEnemy: bestEnemy,
    hitDist: bestDist,
    isHeadshot,
  };
}

export function findSuitableSpawnPoint(
  playerX: number,
  playerZ: number,
  enemies: readonly EnemyState[],
  minPlayerDist = 9.0,
  rng: () => number = Math.random
): { x: number; z: number } | null {
  const candidates: Array<{ x: number; z: number; score: number }> = [];

  for (let i = 0; i < ENEMY_SPAWN_POINTS.length; i++) {
    const p = ENEMY_SPAWN_POINTS[i];
    const distToPlayer = Math.hypot(p.x - playerX, p.z - playerZ);
    if (distToPlayer < minPlayerDist) continue;

    let minEnemyDist = 999;
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      if (!e.active) continue;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      if (d < minEnemyDist) minEnemyDist = d;
    }

    if (minEnemyDist < 2.2) continue;

    // Prefer mid-distance rooms (11m-24m) with slight randomness
    const idealPenalty = Math.abs(distToPlayer - 16);
    candidates.push({
      x: p.x,
      z: p.z,
      score: idealPenalty - Math.min(minEnemyDist, 8) * 0.5 + rng() * 4,
    });
  }

  if (candidates.length === 0) {
    // Fallback: pick farthest spawn point from player
    let best = ENEMY_SPAWN_POINTS[0];
    let bestD = -1;
    for (let i = 0; i < ENEMY_SPAWN_POINTS.length; i++) {
      const p = ENEMY_SPAWN_POINTS[i];
      const d = Math.hypot(p.x - playerX, p.z - playerZ);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    return bestD > 3.0 ? { x: best.x, z: best.z } : null;
  }

  candidates.sort((a, b) => a.score - b.score);
  const pick = candidates[Math.floor(rng() * Math.min(3, candidates.length))];
  return { x: pick.x, z: pick.z };
}

export function createEnemyConfig(policy: EnemyPolicy): {
  maxHp: number;
  speed: number;
  radius: number;
  height: number;
} {
  switch (policy) {
    case 'brute':
      return { maxHp: 90, speed: 3.1, radius: 0.55, height: 1.95 };
    case 'strafer':
      return { maxHp: 50, speed: 4.3, radius: 0.45, height: 1.75 };
    case 'rusher':
    default:
      return { maxHp: 55, speed: 4.7, radius: 0.46, height: 1.78 };
  }
}

/**
 * Lightweight steering target: direct line-of-sight if clear, otherwise
 * route via the best visible doorway/room node that moves closer to the player.
 */
export function getSteerTarget(
  ex: number,
  ez: number,
  px: number,
  pz: number
): { tx: number; tz: number; direct: boolean } {
  if (hasLineOfSight2D(ex, ez, px, pz, 1.0)) {
    return { tx: px, tz: pz, direct: true };
  }

  let bestX = px;
  let bestZ = pz;
  let bestCost = 1e9;

  for (let i = 0; i < NAV_NODES.length; i++) {
    const n = NAV_NODES[i];
    const distFromEnemy = Math.hypot(n.x - ex, n.z - ez);
    if (distFromEnemy < 1.2) continue;
    if (!hasLineOfSight2D(ex, ez, n.x, n.z, 1.0)) continue;

    const distToPlayer = Math.hypot(px - n.x, pz - n.z);
    const losBonus = hasLineOfSight2D(n.x, n.z, px, pz, 1.0) ? -6 : 0;
    const cost = distFromEnemy * 0.45 + distToPlayer + losBonus;
    if (cost < bestCost) {
      bestCost = cost;
      bestX = n.x;
      bestZ = n.z;
    }
  }

  return { tx: bestX, tz: bestZ, direct: false };
}
