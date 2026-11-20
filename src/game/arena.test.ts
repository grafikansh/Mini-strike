import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARENA_COLLIDERS,
  PLAYER_RADIUS,
  PLAYER_SPAWN,
  createEnemyConfig,
  findSuitableSpawnPoint,
  getSteerTarget,
  hasLineOfSight2D,
  raycastArena,
  resolveCircleAABB,
  resolveHitscanShot,
} from './arena';
import type { EnemyState } from './types';

function makeEnemy(id: number, x: number, z: number, policy: 'rusher' | 'strafer' | 'brute' = 'rusher'): EnemyState {
  const cfg = createEnemyConfig(policy);
  return {
    id,
    active: true,
    policy,
    x,
    y: 0,
    z,
    yaw: 0,
    hp: cfg.maxHp,
    maxHp: cfg.maxHp,
    speed: cfg.speed,
    radius: cfg.radius,
    height: cfg.height,
    hitFlash: 0,
    koTimer: 0,
    attackCooldown: 0,
    attackWindup: 0,
    strafeSign: 1,
    walkPhase: 0,
  };
}

test('player spawn is clear of all arena colliders and faces an open doorway', () => {
  const resolved = resolveCircleAABB(PLAYER_SPAWN.x, PLAYER_SPAWN.z, PLAYER_RADIUS);
  assert.ok(Math.abs(resolved.x - PLAYER_SPAWN.x) < 1e-6);
  assert.ok(Math.abs(resolved.z - PLAYER_SPAWN.z) < 1e-6);

  // Facing -Z (0, 0, -1): North doorway at z=-7 should be completely clear straight ahead
  const distAhead = raycastArena(PLAYER_SPAWN.x, 1.65, PLAYER_SPAWN.z, 0, 0, -1, 50);
  assert.ok(distAhead > 25, `Expected open sightline ahead, got ${distAhead}`);
});

test('circle-AABB collision pushes player out of walls while allowing doorway passage', () => {
  // Attempt to walk into North divider wall at x=6, z=-7
  const blocked = resolveCircleAABB(6, -7, PLAYER_RADIUS);
  assert.ok(blocked.z <= -8 - PLAYER_RADIUS + 1e-4 || blocked.z >= -6 + PLAYER_RADIUS - 1e-4);

  // Walk through open North doorway at x=0, z=-7
  const doorway = resolveCircleAABB(0, -7, PLAYER_RADIUS);
  assert.equal(doorway.x, 0);
  assert.equal(doorway.z, -7);
});

test('hitscan shot accurately hits enemy or blocks on cover/wall', () => {
  const enemies: EnemyState[] = [
    makeEnemy(0, 0, -14),
  ];

  // Direct center shot toward -Z from (0, 1.2, 0)
  const hit = resolveHitscanShot(0, 1.2, 0, 0, 0, -1, enemies);
  assert.equal(hit.hitEnemy?.id, 0);
  assert.equal(hit.isHeadshot, false);
  assert.ok(hit.hitDist > 13 && hit.hitDist < 14);

  // Headshot height
  const headHit = resolveHitscanShot(0, 1.55, 0, 0, 0, -1, enemies);
  assert.equal(headHit.hitEnemy?.id, 0);
  assert.equal(headHit.isHeadshot, true);

  // Enemy behind Central Hall cover crate at x=4.5, z=2 (height 1.55)
  const coveredEnemies: EnemyState[] = [
    makeEnemy(1, 4.5, -2),
  ];
  const blockedShot = resolveHitscanShot(4.5, 1.0, 8, 0, 0, -1, coveredEnemies);
  assert.equal(blockedShot.hitEnemy, null);
  assert.ok(blockedShot.hitWallDist < 6);
});

test('enemy spawn finder never spawns inside player or inside colliders', () => {
  const existing = [makeEnemy(0, 0, -18)];
  for (let i = 0; i < 20; i++) {
    const pt = findSuitableSpawnPoint(PLAYER_SPAWN.x, PLAYER_SPAWN.z, existing, 9.0, () => (i * 0.17) % 1);
    assert.ok(pt !== null);
    const dPlayer = Math.hypot(pt.x - PLAYER_SPAWN.x, pt.z - PLAYER_SPAWN.z);
    assert.ok(dPlayer >= 9.0, `Spawn too close to player: ${dPlayer}`);

    // Verify spawn point is not overlapping any wall/cover
    const resolved = resolveCircleAABB(pt.x, pt.z, 0.55, ARENA_COLLIDERS);
    assert.ok(Math.hypot(resolved.x - pt.x, resolved.z - pt.z) < 1e-4);
  }
});

test('doorway navigation steers enemy from West Wing into Central Hall when LOS is blocked', () => {
  // Enemy at (-18, 10) in West Wing, player at (0, 8) in Central Hall (wall at x=-11 blocks direct LOS)
  assert.equal(hasLineOfSight2D(-18, 10, 0, 8, 1.0), false);
  const target = getSteerTarget(-18, 10, 0, 8);
  assert.equal(target.direct, false);
  assert.ok(target.tz < 5, `Expected waypoint toward West doorway (z~0), got (${target.tx}, ${target.tz})`);
});
