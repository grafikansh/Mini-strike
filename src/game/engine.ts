import * as THREE from 'three';
import {
  ARENA_COLLIDERS,
  INITIAL_ENEMY_COUNT,
  MAX_ACTIVE_ENEMIES,
  PLAYER_EYE_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SPAWN,
  createEnemyConfig,
  findSuitableSpawnPoint,
  getSteerTarget,
  resolveCircleAABB,
  resolveHitscanShot,
} from './arena';
import { playHitSfx, playHurtSfx, playKillSfx, playShootSfx, unlockAudio } from './audio';
import { buildArenaMeshes, buildEnemyVisual, buildMp5Viewmodel } from './models';
import type { EnemyVisual } from './models';
import type { EnemyPolicy, EnemyState, GamePhase, HudSnapshot, PlayerState } from './types';

export interface EngineCallbacks {
  onHudUpdate: (hud: HudSnapshot) => void;
  onPhaseRequest: (phase: GamePhase) => void;
}

export interface GameEngineHandle {
  startNewRun: (fromUserGesture?: boolean) => void;
  setPhase: (phase: GamePhase) => void;
  setSensitivity: (val: number) => void;
  spawnEnemyFromInput: () => boolean;
  dispose: () => void;
}

const POLICIES: readonly EnemyPolicy[] = ['rusher', 'strafer', 'brute'];

// Pre-allocated scratch math objects (zero GC in render loop)
const _dir = new THREE.Vector3();
const _startPos = new THREE.Vector3();
const _endPos = new THREE.Vector3();
const _midPos = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

interface TracerSlot {
  mesh: THREE.Mesh;
  timer: number;
}

interface SparkSlot {
  mesh: THREE.Mesh;
  timer: number;
}

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export function mountGameEngine(
  container: HTMLElement,
  initialSensitivity: number,
  callbacks: EngineCallbacks
): GameEngineHandle {
  const isSoftwareGl = detectSoftwareGl();

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

  const canvas = renderer.domElement;
  canvas.setAttribute('data-testid', 'game-canvas');
  canvas.tabIndex = 0;
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1319);
  scene.fog = new THREE.Fog(0x0e1319, 18, 52);

  const camera = new THREE.PerspectiveCamera(
    74,
    (container.clientWidth || window.innerWidth) / Math.max(1, container.clientHeight || window.innerHeight),
    0.08,
    70
  );
  scene.add(camera);

  // Lightweight 2-light rig (zero shadows, zero reflections)
  const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x475569, 1.3);
  scene.add(hemiLight);
  const dirLight = new THREE.DirectionalLight(0xfff1d6, 0.9);
  dirLight.position.set(12, 22, 10);
  scene.add(dirLight);

  const arena = buildArenaMeshes();
  scene.add(arena.group);

  const viewmodel = buildMp5Viewmodel();
  camera.add(viewmodel.root);
  viewmodel.root.visible = false;

  // Pooled bullet tracers (6)
  const tracerGeo = new THREE.BoxGeometry(0.024, 0.024, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  const tracers: TracerSlot[] = [];
  for (let i = 0; i < 6; i++) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, timer: 0 });
  }
  let tracerCursor = 0;

  // Pooled wall sparks (4)
  const sparkGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfdba74 });
  const sparks: SparkSlot[] = [];
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, timer: 0 });
  }
  let sparkCursor = 0;

  // Pre-allocated enemy pool (max 6 active for TV performance)
  const enemyStates: EnemyState[] = [];
  const enemyVisuals: EnemyVisual[] = [];
  for (let i = 0; i < MAX_ACTIVE_ENEMIES; i++) {
    const policy = POLICIES[i % POLICIES.length];
    const cfg = createEnemyConfig(policy);
    enemyStates.push({
      id: i,
      active: false,
      policy,
      x: 0,
      y: 0,
      z: -18,
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
      strafeSign: i % 2 === 0 ? 1 : -1,
      walkPhase: 0,
    });
    const visual = buildEnemyVisual(policy);
    visual.group.visible = false;
    scene.add(visual.group);
    enemyVisuals.push(visual);
  }

  // Mutable simulation state
  let currentPhase: GamePhase = 'title';
  let sensitivity = initialSensitivity;
  let titlePanTime = 0;
  let fireCooldown = 0;
  let spawnCounter = 0;
  let wasPointerLocked = false;

  const player: PlayerState = {
    x: PLAYER_SPAWN.x,
    y: PLAYER_SPAWN.y,
    z: PLAYER_SPAWN.z,
    vy: 0,
    yaw: PLAYER_SPAWN.yaw,
    pitch: PLAYER_SPAWN.pitch,
    health: 100,
    maxHealth: 100,
    grounded: true,
    recoil: 0,
    camKickPitch: 0,
    camKickYaw: 0,
    muzzleFlashTimer: 0,
    hitFeedbackTimer: 0,
    hurtFlashTimer: 0,
    walkPhase: 0,
  };

  let lastHudHealth = -1;
  let lastHudEnemies = -1;
  let lastHudHit = false;
  let lastHudHurt = false;

  function emitHudIfChanged(force = false): void {
    let activeCount = 0;
    for (let i = 0; i < enemyStates.length; i++) {
      if (enemyStates[i].active && enemyStates[i].koTimer === 0) activeCount++;
    }
    const h = Math.max(0, Math.round(player.health));
    const hit = player.hitFeedbackTimer > 0;
    const hurt = player.hurtFlashTimer > 0;

    if (
      force ||
      h !== lastHudHealth ||
      activeCount !== lastHudEnemies ||
      hit !== lastHudHit ||
      hurt !== lastHudHurt
    ) {
      lastHudHealth = h;
      lastHudEnemies = activeCount;
      lastHudHit = hit;
      lastHudHurt = hurt;
      document.body.dataset.enemies = String(activeCount);
      document.body.dataset.health = String(h);
      callbacks.onHudUpdate({
        health: h,
        enemyCount: activeCount,
        hitMarker: hit,
        hurtFlash: hurt,
      });
    }
  }

  function spawnOneEnemy(): boolean {
    let slotIdx = -1;
    for (let i = 0; i < enemyStates.length; i++) {
      if (!enemyStates[i].active) {
        slotIdx = i;
        break;
      }
    }
    if (slotIdx === -1) return false;

    const pt = findSuitableSpawnPoint(player.x, player.z, enemyStates, 8.5);
    if (!pt) return false;

    const e = enemyStates[slotIdx];
    const vis = enemyVisuals[slotIdx];
    const cfg = createEnemyConfig(e.policy);
    e.active = true;
    e.x = pt.x;
    e.y = 0;
    e.z = pt.z;
    e.hp = cfg.maxHp;
    e.maxHp = cfg.maxHp;
    e.speed = cfg.speed;
    e.radius = cfg.radius;
    e.height = cfg.height;
    e.hitFlash = 0;
    e.koTimer = 0;
    e.attackCooldown = 0.6;
    e.attackWindup = 0;
    e.walkPhase = (spawnCounter++ * 1.1) % (Math.PI * 2);
    e.yaw = Math.atan2(player.x - e.x, player.z - e.z);

    vis.group.position.set(e.x, 0, e.z);
    vis.group.scale.set(1, 1, 1);
    vis.group.rotation.set(0, e.yaw, 0);
    vis.group.visible = true;
    setEnemyTint(vis, false);
    emitHudIfChanged(true);
    return true;
  }

  function setEnemyTint(vis: EnemyVisual, flashWhite: boolean): void {
    for (let i = 0; i < vis.bodyMeshes.length; i++) {
      const mat = vis.bodyMeshes[i].material as THREE.MeshLambertMaterial;
      if (flashWhite) {
        mat.emissive.setHex(0xffffff);
        mat.emissiveIntensity = 0.75;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
    }
  }

  function resetRunState(): void {
    player.x = PLAYER_SPAWN.x;
    player.y = PLAYER_SPAWN.y;
    player.z = PLAYER_SPAWN.z;
    player.vy = 0;
    player.yaw = PLAYER_SPAWN.yaw;
    player.pitch = PLAYER_SPAWN.pitch;
    player.health = 100;
    player.grounded = true;
    player.recoil = 0;
    player.camKickPitch = 0;
    player.camKickYaw = 0;
    player.muzzleFlashTimer = 0;
    player.hitFeedbackTimer = 0;
    player.hurtFlashTimer = 0;
    player.walkPhase = 0;
    fireCooldown = 0;

    for (let i = 0; i < enemyStates.length; i++) {
      enemyStates[i].active = false;
      enemyStates[i].koTimer = 0;
      enemyVisuals[i].group.visible = false;
    }

    for (let i = 0; i < INITIAL_ENEMY_COUNT; i++) {
      spawnOneEnemy();
    }

    emitHudIfChanged(true);
  }

  // Input state (cleared on blur/pause)
  const keys = new Set<string>();
  let mouseDown = false;
  let lastPointerX: number | null = null;
  let lastPointerY: number | null = null;
  let ignoreLookUntil = 0;

  function clearInputs(): void {
    keys.clear();
    mouseDown = false;
    lastPointerX = null;
    lastPointerY = null;
  }

  function tryRequestPointerLock(): void {
    try {
      if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
        const res = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
      }
    } catch {
      // Ignore on browsers/TVs without pointer lock
    }
  }

  function tryExitPointerLock(): void {
    try {
      if (document.pointerLockElement && document.exitPointerLock) {
        document.exitPointerLock();
      }
    } catch {
      // Ignore
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (currentPhase !== 'playing') return;

    if (e.code === 'Escape') {
      e.preventDefault();
      clearInputs();
      tryExitPointerLock();
      callbacks.onPhaseRequest('paused');
      return;
    }

    keys.add(e.code);
  }

  function onKeyUp(e: KeyboardEvent): void {
    keys.delete(e.code);
  }

  function onPointerLockChange(): void {
    const locked = document.pointerLockElement === canvas;
    if (locked) {
      // Suppress browser's initial pointer-lock warp spike
      ignoreLookUntil = performance.now() + 80;
      lastPointerX = null;
      lastPointerY = null;
    } else if (wasPointerLocked && currentPhase === 'playing') {
      // Browser consumed ESC to unlock pointer -> immediately pause gameplay
      clearInputs();
      callbacks.onPhaseRequest('paused');
    }
    wasPointerLocked = locked;
  }

  function applyLookDelta(dx: number, dy: number): void {
    if (performance.now() < ignoreLookUntil) return;
    if (Math.abs(dx) > 160 || Math.abs(dy) > 160) return;
    const baseScale = 0.0022 * sensitivity;
    player.yaw -= dx * baseScale;
    player.pitch -= dy * baseScale;
    if (player.pitch > 1.45) player.pitch = 1.45;
    if (player.pitch < -1.45) player.pitch = -1.45;
  }

  function onMouseMove(e: MouseEvent): void {
    if (currentPhase !== 'playing') return;

    if (document.pointerLockElement === canvas) {
      applyLookDelta(e.movementX || 0, e.movementY || 0);
      return;
    }

    // Fallback smooth mouse look for Smart TV / Android / unlocked browsers
    let dx = e.movementX;
    let dy = e.movementY;
    if (!dx && !dy) {
      if (lastPointerX !== null && lastPointerY !== null) {
        dx = e.clientX - lastPointerX;
        dy = e.clientY - lastPointerY;
      } else {
        dx = 0;
        dy = 0;
      }
    }
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    applyLookDelta(dx, dy);
  }

  function onMouseDown(e: MouseEvent): void {
    if (currentPhase !== 'playing') return;
    if (e.button !== 0) return;
    unlockAudio();
    mouseDown = true;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    if (document.pointerLockElement !== canvas) {
      tryRequestPointerLock();
    }
  }

  function onMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      mouseDown = false;
    }
  }

  function onWheel(e: WheelEvent): void {
    if (currentPhase !== 'playing') return;
    e.preventDefault();
    spawnOneEnemy();
  }

  function onBlur(): void {
    clearInputs();
  }

  function onVisibilityChange(): void {
    if (document.hidden) {
      clearInputs();
    }
  }

  function onResize(): void {
    const w = container.clientWidth || window.innerWidth;
    const h = Math.max(1, container.clientHeight || window.innerHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  window.addEventListener('resize', onResize);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function fireBullet(): void {
    playShootSfx();
    player.recoil = Math.min(0.06, player.recoil + 0.036);
    player.camKickPitch = Math.min(0.025, player.camKickPitch + 0.0085);
    player.camKickYaw += (Math.random() - 0.5) * 0.005;
    player.muzzleFlashTimer = 0.035;
    viewmodel.muzzleFlash.visible = true;
    viewmodel.muzzleFlash.rotation.z = Math.random() * Math.PI * 2;

    // Exact center crosshair ray from camera
    _euler.set(player.pitch + player.camKickPitch, player.yaw + player.camKickYaw, 0, 'YXZ');
    _dir.set(0, 0, -1).applyEuler(_euler).normalize();

    const ox = player.x;
    const oy = player.y + PLAYER_EYE_HEIGHT;
    const oz = player.z;

    const shot = resolveHitscanShot(ox, oy, oz, _dir.x, _dir.y, _dir.z, enemyStates, 75, ARENA_COLLIDERS);

    // Spawn lightweight pooled tracer from muzzle tip to hit point
    _startPos.copy(viewmodel.muzzleTipLocal).applyMatrix4(camera.matrixWorld);
    _endPos.set(
      ox + _dir.x * shot.hitDist,
      oy + _dir.y * shot.hitDist,
      oz + _dir.z * shot.hitDist
    );
    const tracerLen = Math.max(0.2, _startPos.distanceTo(_endPos));
    const slot = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % tracers.length;
    _midPos.addVectors(_startPos, _endPos).multiplyScalar(0.5);
    slot.mesh.position.copy(_midPos);
    slot.mesh.scale.set(1, 1, tracerLen);
    slot.mesh.lookAt(_endPos);
    slot.mesh.visible = true;
    slot.timer = 0.048;

    if (shot.hitEnemy) {
      const e = shot.hitEnemy;
      const dmg = shot.isHeadshot ? 32 : 20;
      e.hp -= dmg;
      e.hitFlash = 0.08;
      player.hitFeedbackTimer = 0.09;
      setEnemyTint(enemyVisuals[e.id], true);

      if (e.hp <= 0) {
        e.hp = 0;
        e.koTimer = 0.16;
        playKillSfx();
      } else {
        playHitSfx(shot.isHeadshot);
      }
      emitHudIfChanged();
    } else if (shot.hitWallDist < 74) {
      // Tiny wall spark
      const sp = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % sparks.length;
      sp.mesh.position.copy(_endPos);
      sp.mesh.visible = true;
      sp.timer = 0.06;
    }
  }

  function stepPlaying(dt: number): void {
    // 1. Player movement (WASD + Shift sprint + Space jump)
    let moveForward = 0;
    let moveRight = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) moveForward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) moveForward -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) moveRight += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) moveRight -= 1;

    const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = sprinting ? 8.8 : 5.5;

    if (moveForward !== 0 || moveRight !== 0) {
      const len = Math.hypot(moveForward, moveRight);
      const nf = moveForward / len;
      const nr = moveRight / len;
      const sinY = Math.sin(player.yaw);
      const cosY = Math.cos(player.yaw);

      // Forward is (-sinY, -cosY), Right is (cosY, -sinY)
      const vx = (-sinY * nf + cosY * nr) * speed * dt;
      const vz = (-cosY * nf - sinY * nr) * speed * dt;
      const resolved = resolveCircleAABB(player.x + vx, player.z + vz, PLAYER_RADIUS, ARENA_COLLIDERS);
      player.x = resolved.x;
      player.z = resolved.z;

      player.walkPhase += dt * (sprinting ? 13 : 9);
    }

    // Jump & gravity
    if (keys.has('Space') && player.grounded) {
      player.vy = 6.4;
      player.grounded = false;
    }
    player.vy -= 18.5 * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) {
      player.y = 0;
      player.vy = 0;
      player.grounded = true;
    }

    // 2. Firing (continuous while left mouse held, immediate stop on release)
    if (fireCooldown > 0) fireCooldown -= dt;
    if (mouseDown && fireCooldown <= 0) {
      fireBullet();
      fireCooldown = 0.095;
    }

    // 3. Recoil & feedback decay
    const damp = Math.exp(-16 * dt);
    player.recoil *= damp;
    player.camKickPitch *= Math.exp(-12 * dt);
    player.camKickYaw *= Math.exp(-12 * dt);

    if (player.muzzleFlashTimer > 0) {
      player.muzzleFlashTimer -= dt;
      if (player.muzzleFlashTimer <= 0) {
        viewmodel.muzzleFlash.visible = false;
      }
    }
    if (player.hitFeedbackTimer > 0) {
      player.hitFeedbackTimer = Math.max(0, player.hitFeedbackTimer - dt);
    }
    if (player.hurtFlashTimer > 0) {
      player.hurtFlashTimer = Math.max(0, player.hurtFlashTimer - dt);
    }

    // Update camera transform
    camera.position.set(player.x, player.y + PLAYER_EYE_HEIGHT, player.z);
    _euler.set(player.pitch + player.camKickPitch, player.yaw + player.camKickYaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(_euler);

    // Update viewmodel recoil & subtle walk bob
    const isMoving = moveForward !== 0 || moveRight !== 0;
    const bobAmp = isMoving && player.grounded ? 0.008 : 0.0012;
    const bobX = Math.cos(player.walkPhase) * bobAmp;
    const bobY = Math.abs(Math.sin(player.walkPhase)) * bobAmp;
    viewmodel.gunPivot.position.set(0.23 + bobX, -0.21 - bobY, -0.42 + player.recoil);
    viewmodel.gunPivot.rotation.set(player.recoil * 1.4, 0, 0);

    // 4. Pooled tracers & sparks
    for (let i = 0; i < tracers.length; i++) {
      const tr = tracers[i];
      if (tr.timer > 0) {
        tr.timer -= dt;
        if (tr.timer <= 0) tr.mesh.visible = false;
      }
    }
    for (let i = 0; i < sparks.length; i++) {
      const sp = sparks[i];
      if (sp.timer > 0) {
        sp.timer -= dt;
        if (sp.timer <= 0) sp.mesh.visible = false;
      }
    }

    // 5. Enemies update
    for (let i = 0; i < enemyStates.length; i++) {
      const e = enemyStates[i];
      if (!e.active) continue;
      const vis = enemyVisuals[i];

      if (e.hitFlash > 0) {
        e.hitFlash -= dt;
        if (e.hitFlash <= 0) {
          setEnemyTint(vis, false);
        }
      }

      if (e.koTimer > 0) {
        e.koTimer -= dt;
        const s = Math.max(0.05, e.koTimer / 0.16);
        vis.group.scale.set(1, s, 1);
        if (e.koTimer <= 0) {
          e.active = false;
          e.koTimer = 0;
          vis.group.visible = false;
          emitHudIfChanged();
        }
        continue;
      }

      const toPlayerX = player.x - e.x;
      const toPlayerZ = player.z - e.z;
      const distToPlayer = Math.hypot(toPlayerX, toPlayerZ);

      // Steering toward player (direct or via doorway)
      const target = getSteerTarget(e.x, e.z, player.x, player.z);
      const dx = target.tx - e.x;
      const dz = target.tz - e.z;
      const dLen = Math.hypot(dx, dz) || 1;
      let moveX = dx / dLen;
      let moveZ = dz / dLen;

      // Strafer policy weaves laterally when close with clear LOS
      if (e.policy === 'strafer' && target.direct && distToPlayer < 12 && distToPlayer > 2.2) {
        const perpX = -moveZ * e.strafeSign;
        const perpZ = moveX * e.strafeSign;
        moveX = moveX * 0.72 + perpX * 0.68;
        moveZ = moveZ * 0.72 + perpZ * 0.68;
        const mLen = Math.hypot(moveX, moveZ) || 1;
        moveX /= mLen;
        moveZ /= mLen;
      }

      // Enemy-to-enemy soft separation
      for (let j = 0; j < enemyStates.length; j++) {
        if (i === j) continue;
        const o = enemyStates[j];
        if (!o.active || o.koTimer > 0) continue;
        const sx = e.x - o.x;
        const sz = e.z - o.z;
        const sd = Math.hypot(sx, sz);
        const minSep = e.radius + o.radius + 0.2;
        if (sd > 0.001 && sd < minSep) {
          const push = (minSep - sd) / minSep;
          moveX += (sx / sd) * push * 1.4;
          moveZ += (sz / sd) * push * 1.4;
        }
      }

      // Approach unless already in melee contact
      if (distToPlayer > e.radius + PLAYER_RADIUS + 0.25) {
        const stepX = moveX * e.speed * dt;
        const stepZ = moveZ * e.speed * dt;
        const res = resolveCircleAABB(e.x + stepX, e.z + stepZ, e.radius, ARENA_COLLIDERS);
        e.x = res.x;
        e.z = res.z;
        e.walkPhase += dt * e.speed * 2.2;
      }

      // Prevent enemy overlapping inside player
      const sepPlayer = e.radius + PLAYER_RADIUS + 0.15;
      if (distToPlayer < sepPlayer && distToPlayer > 0.001) {
        const push = sepPlayer - distToPlayer;
        const res = resolveCircleAABB(
          e.x - (toPlayerX / distToPlayer) * push,
          e.z - (toPlayerZ / distToPlayer) * push,
          e.radius,
          ARENA_COLLIDERS
        );
        e.x = res.x;
        e.z = res.z;
      }

      // Face target / player
      const lookX = target.direct ? toPlayerX : dx;
      const lookZ = target.direct ? toPlayerZ : dz;
      e.yaw = Math.atan2(lookX, lookZ);

      // Attack with clear windup telegraph
      if (e.attackCooldown > 0) e.attackCooldown -= dt;
      if (distToPlayer <= 2.1 && e.attackCooldown <= 0) {
        if (e.attackWindup <= 0) {
          e.attackWindup = 0.3;
        }
      }

      if (e.attackWindup > 0) {
        e.attackWindup -= dt;
        // Raise arms during windup telegraph
        vis.leftArm.rotation.x = -1.2;
        vis.rightArm.rotation.x = -1.2;
        if (e.attackWindup <= 0) {
          e.attackCooldown = 0.85;
          if (Math.hypot(player.x - e.x, player.z - e.z) <= 2.35) {
            player.health = Math.max(0, player.health - (e.policy === 'brute' ? 20 : 15));
            player.hurtFlashTimer = 0.2;
            playHurtSfx();
            emitHudIfChanged();
            if (player.health <= 0) {
              clearInputs();
              tryExitPointerLock();
              callbacks.onPhaseRequest('gameover');
              return;
            }
          }
        }
      } else {
        const swing = Math.sin(e.walkPhase) * 0.55;
        vis.leftLeg.rotation.x = swing;
        vis.rightLeg.rotation.x = -swing;
        vis.leftArm.rotation.x = -swing * 0.6;
        vis.rightArm.rotation.x = swing * 0.6;
      }

      vis.group.position.set(e.x, 0, e.z);
      vis.group.rotation.set(0, e.yaw, 0);
    }

    emitHudIfChanged();
  }

  function stepTitleCamera(dt: number): void {
    titlePanTime += dt * 0.22;
    const cx = Math.sin(titlePanTime) * 6.5;
    const cz = 3.5 + Math.cos(titlePanTime) * 4.5;
    camera.position.set(cx, 2.75, cz);
    _midPos.set(0, 1.4, -10);
    camera.lookAt(_midPos);
  }

  // Frame loop with Software WebGL afterDraw pacing
  let frameId = 0;
  let disposed = false;
  let lastTs = performance.now();

  function afterDraw(cb: () => void): void {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    } else {
      frameId = window.setTimeout(cb, 80);
    }
  }

  function tick(now?: number): void {
    if (disposed) return;
    const ts = typeof now === 'number' ? now : performance.now();
    const rawDt = (ts - lastTs) / 1000;
    lastTs = ts;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    if (currentPhase === 'playing') {
      stepPlaying(dt);
    } else if (currentPhase === 'title' || currentPhase === 'settings') {
      stepTitleCamera(dt);
    }

    renderer.render(scene, camera);

    if (isSoftwareGl) {
      afterDraw(() => tick());
    } else {
      frameId = requestAnimationFrame(tick);
    }
  }

  // Kick off initial render loop
  resetRunState();
  if (!isSoftwareGl) {
    renderer.compile(scene, camera);
  }
  frameId = requestAnimationFrame(tick);

  return {
    startNewRun: (fromUserGesture = true) => {
      clearInputs();
      ignoreLookUntil = performance.now() + 80;
      resetRunState();
      currentPhase = 'playing';
      viewmodel.root.visible = true;
      canvas.focus();
      if (fromUserGesture) {
        unlockAudio();
        tryRequestPointerLock();
        try {
          if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            const p = document.documentElement.requestFullscreen() as unknown as Promise<void> | undefined;
            if (p && typeof p.catch === 'function') p.catch(() => {});
          }
        } catch {
          // Ignore fullscreen refusal on unsupported TVs/iframes
        }
      }
    },
    setPhase: (phase: GamePhase) => {
      currentPhase = phase;
      viewmodel.root.visible = phase === 'playing' || phase === 'paused' || phase === 'gameover';
      if (phase !== 'playing') {
        clearInputs();
        tryExitPointerLock();
      } else {
        canvas.focus();
        tryRequestPointerLock();
      }
    },
    setSensitivity: (val: number) => {
      sensitivity = Math.max(0.1, Math.min(3.5, val));
    },
    spawnEnemyFromInput: () => {
      if (currentPhase !== 'playing') return false;
      return spawnOneEnemy();
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);

      arena.dispose();
      viewmodel.dispose();
      enemyVisuals.forEach((v) => v.dispose());
      tracerGeo.dispose();
      tracerMat.dispose();
      sparkGeo.dispose();
      sparkMat.dispose();
      renderer.dispose();
      if (canvas.parentElement === container) {
        container.removeChild(canvas);
      }
    },
  };
}
