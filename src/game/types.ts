export type GamePhase = 'title' | 'settings' | 'playing' | 'paused' | 'gameover';

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  kind: 'wall' | 'cover';
}

export type EnemyPolicy = 'rusher' | 'strafer' | 'brute';

export interface EnemyState {
  id: number;
  active: boolean;
  policy: EnemyPolicy;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  height: number;
  hitFlash: number;
  koTimer: number;
  attackCooldown: number;
  attackWindup: number;
  strafeSign: number;
  walkPhase: number;
}

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vy: number;
  yaw: number;
  pitch: number;
  health: number;
  maxHealth: number;
  grounded: boolean;
  recoil: number;
  camKickPitch: number;
  camKickYaw: number;
  muzzleFlashTimer: number;
  hitFeedbackTimer: number;
  hurtFlashTimer: number;
  walkPhase: number;
}

export interface HudSnapshot {
  health: number;
  enemyCount: number;
  hitMarker: boolean;
  hurtFlash: boolean;
}
