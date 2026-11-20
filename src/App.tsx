import { useEffect, useRef, useState } from 'react';
import { mountGameEngine } from './game/engine';
import type { GameEngineHandle } from './game/engine';
import type { GamePhase, HudSnapshot } from './game/types';

const SENSITIVITY_STORAGE_KEY = 'ministrike3d_sensitivity';

function loadInitialSensitivity(): number {
  try {
    const raw = localStorage.getItem(SENSITIVITY_STORAGE_KEY);
    if (raw) {
      const parsed = parseFloat(raw);
      if (Number.isFinite(parsed) && parsed >= 0.2 && parsed <= 3.0) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage restriction
  }
  return 1.0;
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngineHandle | null>(null);

  const [phase, setPhase] = useState<GamePhase>('title');
  const [sensitivity, setSensitivity] = useState<number>(loadInitialSensitivity);
  const [hud, setHud] = useState<HudSnapshot>({
    health: 100,
    enemyCount: 2,
    hitMarker: false,
    hurtFlash: false,
  });

  const phaseRef = useRef<GamePhase>(phase);
  phaseRef.current = phase;

  useEffect(() => {
    document.body.dataset.state = phase;
  }, [phase]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const handle = mountGameEngine(container, sensitivity, {
      onHudUpdate: (nextHud) => setHud(nextHud),
      onPhaseRequest: (nextPhase) => {
        setPhase(nextPhase);
        handle.setPhase(nextPhase);
      },
    });
    engineRef.current = handle;

    // Support ?autostart=1 for automated testing
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      setPhase('playing');
      handle.startNewRun(false);
    }

    return () => {
      engineRef.current = null;
      handle.dispose();
    };
    // Mount WebGL canvas once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = (e?: { currentTarget?: HTMLElement }) => {
    e?.currentTarget?.blur();
    setPhase('playing');
    engineRef.current?.startNewRun();
  };

  const handleResume = (e?: { currentTarget?: HTMLElement }) => {
    e?.currentTarget?.blur();
    setPhase('playing');
    engineRef.current?.setPhase('playing');
  };

  const handleRestart = (e?: { currentTarget?: HTMLElement }) => {
    e?.currentTarget?.blur();
    setPhase('playing');
    engineRef.current?.startNewRun();
  };

  const handleSensitivityChange = (val: number) => {
    setSensitivity(val);
    engineRef.current?.setSensitivity(val);
    try {
      localStorage.setItem(SENSITIVITY_STORAGE_KEY, String(val));
    } catch {
      // Ignore storage restriction
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (phaseRef.current === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        handleStart();
      } else if (phaseRef.current === 'settings' && e.code === 'Escape') {
        e.preventDefault();
        setPhase('title');
      } else if (phaseRef.current === 'paused' && e.code === 'Escape') {
        e.preventDefault();
        handleResume();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const healthPct = Math.max(0, Math.min(100, hud.health));
  const healthBarColor = healthPct > 50 ? '#38bdf8' : healthPct > 25 ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0e1319]">
      {/* Isolated WebGL canvas mount */}
      <div ref={mountRef} className="absolute inset-0 h-full w-full" />

      {/* Playing HUD: ONLY centre crosshair & player health */}
      {phase === 'playing' && (
        <div className="pointer-events-none fixed inset-0 z-10">
          {hud.hurtFlash && (
            <div
              className="fixed inset-0"
              style={{
                boxShadow: 'inset 0 0 90px rgba(239, 68, 68, 0.55)',
              }}
            />
          )}

          {/* Centre Crosshair */}
          <div
            aria-hidden="true"
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <g stroke="#0b0f14" strokeWidth="3.5" strokeLinecap="square">
                <line x1="14" y1="3" x2="14" y2="9" />
                <line x1="14" y1="19" x2="14" y2="25" />
                <line x1="3" y1="14" x2="9" y2="14" />
                <line x1="19" y1="14" x2="25" y2="14" />
              </g>
              <g
                stroke={hud.hitMarker ? '#facc15' : '#f8fafc'}
                strokeWidth="1.75"
                strokeLinecap="square"
              >
                <line x1="14" y1="3" x2="14" y2="9" />
                <line x1="14" y1="19" x2="14" y2="25" />
                <line x1="3" y1="14" x2="9" y2="14" />
                <line x1="19" y1="14" x2="25" y2="14" />
              </g>
              <circle
                cx="14"
                cy="14"
                r="1.5"
                fill={hud.hitMarker ? '#facc15' : '#f8fafc'}
              />
            </svg>
          </div>

          {/* Player Health */}
          <div
            className="fixed bottom-6 left-6 flex items-center gap-3 rounded border border-slate-700/80 px-4 py-2.5"
            style={{ backgroundColor: 'rgba(14, 19, 25, 0.84)' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2L4 5.5V11.5C4 16.5 7.4 20.9 12 22C16.6 20.9 20 16.5 20 11.5V5.5L12 2Z"
                fill="#1e293b"
                stroke={healthBarColor}
                strokeWidth="2"
              />
              <path d="M12 7.5V16.5M7.5 12H16.5" stroke={healthBarColor} strokeWidth="2.4" />
            </svg>
            <span
              data-testid="player-health"
              className="min-w-[3ch] text-3xl font-extrabold leading-none tracking-tight text-slate-100 tabular-nums"
            >
              {healthPct}
            </span>
            <div className="h-2.5 w-32 overflow-hidden rounded-sm bg-slate-800">
              <div
                className="h-full"
                style={{
                  width: `${healthPct}%`,
                  backgroundColor: healthBarColor,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Menu: ONLY START and SETTINGS */}
      {phase === 'title' && (
        <main className="fixed inset-0 z-20 flex flex-col items-center justify-center px-6">
          <div
            className="flex w-full max-w-md flex-col items-center gap-8 rounded-md border border-slate-700/80 px-8 py-10"
            style={{ backgroundColor: 'rgba(14, 19, 25, 0.88)' }}
          >
            {/* Bespoke inline SVG Title Emblem */}
            <svg
              viewBox="0 0 360 76"
              className="w-full max-w-[320px]"
              role="img"
              aria-label="MINI STRIKE 3D"
            >
              <rect x="2" y="10" width="8" height="56" fill="#38bdf8" />
              <rect x="350" y="10" width="8" height="56" fill="#f59e0b" />
              <text
                x="180"
                y="45"
                textAnchor="middle"
                fill="#f8fafc"
                fontSize="34"
                fontWeight="900"
                letterSpacing="4"
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                MINI STRIKE
              </text>
              <text
                x="180"
                y="68"
                textAnchor="middle"
                fill="#38bdf8"
                fontSize="18"
                fontWeight="800"
                letterSpacing="10"
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                3D
              </text>
            </svg>

            <div className="flex w-full flex-col gap-3.5">
              <button
                type="button"
                data-start="true"
                onClick={(e) => handleStart(e)}
                className="w-full cursor-pointer rounded bg-[#0284c7] py-4 text-xl font-extrabold tracking-widest text-white transition-colors hover:bg-[#0ea5e9] focus:outline-2 focus:outline-offset-2 focus:outline-sky-400"
              >
                START
              </button>
              <button
                type="button"
                onClick={() => setPhase('settings')}
                className="w-full cursor-pointer rounded border border-slate-600 bg-[#1e293b] py-3.5 text-lg font-bold tracking-widest text-slate-100 transition-colors hover:bg-slate-700 focus:outline-2 focus:outline-offset-2 focus:outline-slate-400"
              >
                SETTINGS
              </button>
            </div>
          </div>
        </main>
      )}

      {/* Settings: ONLY Camera Sensitivity slider */}
      {phase === 'settings' && (
        <main className="fixed inset-0 z-20 flex items-center justify-center px-6">
          <div
            className="flex w-full max-w-md flex-col gap-6 rounded-md border border-slate-700/80 p-8"
            style={{ backgroundColor: 'rgba(14, 19, 25, 0.92)' }}
          >
            <h1 className="text-center text-2xl font-extrabold tracking-widest text-slate-100">
              SETTINGS
            </h1>

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="camera-sensitivity"
                  className="text-base font-semibold tracking-wide text-slate-200"
                >
                  Camera Sensitivity
                </label>
                <span className="text-lg font-bold text-sky-400 tabular-nums">
                  {sensitivity.toFixed(1)}
                </span>
              </div>
              <input
                id="camera-sensitivity"
                type="range"
                min={0.2}
                max={3.0}
                step={0.1}
                value={sensitivity}
                onChange={(e) => handleSensitivityChange(parseFloat(e.target.value))}
                className="h-3 w-full cursor-pointer accent-sky-400"
              />
            </div>

            <button
              type="button"
              onClick={() => setPhase('title')}
              className="w-full cursor-pointer rounded border border-slate-600 bg-[#1e293b] py-3.5 text-base font-bold tracking-widest text-slate-100 transition-colors hover:bg-slate-700"
            >
              BACK
            </button>
          </div>
        </main>
      )}

      {/* Pause Modal */}
      {phase === 'paused' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Paused"
          className="fixed inset-0 z-20 flex items-center justify-center px-6"
        >
          <div
            className="flex w-full max-w-sm flex-col gap-4 rounded-md border border-slate-700/80 p-8"
            style={{ backgroundColor: 'rgba(14, 19, 25, 0.92)' }}
          >
            <h2 className="mb-2 text-center text-2xl font-extrabold tracking-widest text-slate-100">
              PAUSED
            </h2>
            <button
              type="button"
              onClick={(e) => handleResume(e)}
              className="w-full cursor-pointer rounded bg-[#0284c7] py-3.5 text-lg font-extrabold tracking-widest text-white transition-colors hover:bg-[#0ea5e9]"
            >
              RESUME
            </button>
            <button
              type="button"
              onClick={(e) => handleRestart(e)}
              className="w-full cursor-pointer rounded border border-slate-600 bg-[#1e293b] py-3 text-base font-bold tracking-widest text-slate-100 transition-colors hover:bg-slate-700"
            >
              RESTART
            </button>
          </div>
        </div>
      )}

      {/* Game Over Modal */}
      {phase === 'gameover' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Game Over"
          className="fixed inset-0 z-20 flex items-center justify-center px-6"
        >
          <div
            className="flex w-full max-w-sm flex-col gap-5 rounded-md border border-red-700/70 p-8"
            style={{ backgroundColor: 'rgba(14, 19, 25, 0.94)' }}
          >
            <h2 className="text-center text-3xl font-black tracking-widest text-red-400">
              GAME OVER
            </h2>
            <button
              type="button"
              data-start="true"
              onClick={(e) => handleRestart(e)}
              className="w-full cursor-pointer rounded bg-[#0284c7] py-4 text-lg font-extrabold tracking-widest text-white transition-colors hover:bg-[#0ea5e9]"
            >
              RESTART
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
