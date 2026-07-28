import { useState, useEffect, useRef } from "react";
import {
  Orbit,
  Play,
  Pause,
  RotateCcw,
  Save,
  Flame,
  Compass,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { apiFetch } from "../lib/api";

interface OrbitalCalculatorProps {
  onActivityAdded: (
    type: "chat" | "problem" | "calculator" | "quiz" | "image",
    desc: string,
  ) => void;
  onSaveNote: (note: {
    type: "concept" | "problem" | "mission" | "calculation";
    title: string;
    content: string;
  }) => void;
}

interface PeriodResult {
  period_s: number;
  period_min: number;
  semi_major_axis_km: number;
  formula: string;
}
interface VelocityResult {
  velocity_kms: number;
  velocity_kmh: number;
  semi_major_axis_km: number;
  formula: string;
}
interface EscapeResult {
  escape_velocity_kms: number;
  escape_velocity_kmh: number;
  semi_major_axis_km: number;
  formula: string;
}
interface EnergyResult {
  specific_energy_kms2: number;
  specific_energy_kmh2: number;
  semi_major_axis_km: number;
  formula: string;
}
interface HohmannResult {
  delta_v1_kms: number;
  delta_v2_kms: number;
  transfer_time_s: number;
  transfer_time_min: number;
  initial_radius_km: number;
  final_radius_km: number;
  dv_total_kms: number;
  formula_delta_v1: string;
  formula_delta_v2: string;
  formula_transfer_time: string;
}
interface CircularData {
  period: PeriodResult;
  velocity: VelocityResult;
  escape: EscapeResult;
  energy: EnergyResult;
}

// Earth constants — used only for SVG scaling placeholders; all displayed
// physics values are sourced from the science service response.
const EARTH_RADIUS_KM = 6378.137;
const DEBOUNCE_MS = 300;

async function callScience<T>(
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 422) {
    let detail = "Invalid input.";
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* keep default */
    }
    throw new Error(detail);
  }
  if (!res.ok) {
    throw new Error(`Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export default function OrbitalCalculator({
  onActivityAdded,
  onSaveNote,
}: OrbitalCalculatorProps) {
  const [altitude, setAltitude] = useState<number>(400);
  const [depAltitude, setDepAltitude] = useState<number>(300);
  const [arrAltitude, setArrAltitude] = useState<number>(35786);

  const [circular, setCircular] = useState<CircularData | null>(null);
  const [circularLoading, setCircularLoading] = useState<boolean>(false);
  const [circularError, setCircularError] = useState<string | null>(null);

  const [hohmann, setHohmann] = useState<HohmannResult | null>(null);
  const [hohmannLoading, setHohmannLoading] = useState<boolean>(false);
  const [hohmannError, setHohmannError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [simSpeed, setSimSpeed] = useState<number>(100);
  const [isHohmannAnimating, setIsHohmannAnimating] = useState<boolean>(false);
  const [hohmannPhase, setHohmannPhase] = useState<
    "idle" | "burn1" | "coasting" | "burn2" | "circular"
  >("idle");
  const [hohmannTimeLeft, setHohmannTimeLeft] = useState<number>(0);

  const angleRef = useRef<number>(0);
  const hohmannAngleRef = useRef<number>(0);
  const [simAngle, setSimAngle] = useState<number>(0);
  const [hohmannSimAngle, setHohmannSimAngle] = useState<number>(0);

  // ---------- Debounced backend calls: circular orbit ----------
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setCircularLoading(true);
      setCircularError(null);
      try {
        const period = await callScience<PeriodResult>(
          "/api/calculate/period",
          { altitude_km: altitude },
          controller.signal,
        );
        const [velocity, escape, energy] = await Promise.all([
          callScience<VelocityResult>(
            "/api/calculate/velocity",
            { altitude_km: altitude },
            controller.signal,
          ),
          callScience<EscapeResult>(
            "/api/calculate/escape-velocity",
            { altitude_km: altitude },
            controller.signal,
          ),
          callScience<EnergyResult>(
            "/api/calculate/energy",
            { semi_major_axis_km: period.semi_major_axis_km },
            controller.signal,
          ),
        ]);
        setCircular({ period, velocity, escape, energy });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setCircular(null);
        setCircularError((err as Error).message);
      } finally {
        setCircularLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [altitude]);

  // ---------- Debounced backend calls: Hohmann transfer ----------
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setHohmannLoading(true);
      setHohmannError(null);
      try {
        const r = await callScience<HohmannResult>(
          "/api/calculate/hohmann",
          { alt1_km: depAltitude, alt2_km: arrAltitude },
          controller.signal,
        );
        setHohmann(r);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setHohmann(null);
        setHohmannError((err as Error).message);
      } finally {
        setHohmannLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [depAltitude, arrAltitude]);

  // ---------- Animation ----------
  const periodSecForAnim = circular?.period.period_s ?? 5554;
  const tofSecForAnim = hohmann?.transfer_time_s ?? 18989;

  useEffect(() => {
    let frameId: number;
    const tick = () => {
      if (isPlaying) {
        const angularVelocity = (2 * Math.PI) / periodSecForAnim;
        const step = angularVelocity * (simSpeed / 60) * 1.5;
        angleRef.current = (angleRef.current + step) % (2 * Math.PI);
        setSimAngle(angleRef.current);

        if (isHohmannAnimating) {
          if (hohmannPhase === "coasting") {
            const hohmannTofMultiplier =
              (Math.PI / tofSecForAnim) * (simSpeed / 60) * 3;
            hohmannAngleRef.current =
              hohmannAngleRef.current + hohmannTofMultiplier;
            if (hohmannAngleRef.current >= Math.PI) {
              hohmannAngleRef.current = Math.PI;
              setHohmannPhase("burn2");
              setTimeout(() => setHohmannPhase("circular"), 1200);
            }
            setHohmannSimAngle(hohmannAngleRef.current);
            setHohmannTimeLeft((prev) => Math.max(0, prev - simSpeed / 30));
          } else if (hohmannPhase === "circular") {
            // Decorative constant rotation on target orbit — not physics.
            const circStep = 0.02 * (simSpeed / 60) * 1.5;
            hohmannAngleRef.current =
              (hohmannAngleRef.current + circStep) % (2 * Math.PI);
            setHohmannSimAngle(hohmannAngleRef.current);
          }
        }
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [
    isPlaying,
    simSpeed,
    periodSecForAnim,
    isHohmannAnimating,
    hohmannPhase,
    tofSecForAnim,
  ]);

  const handleStartHohmannTransfer = () => {
    if (!hohmann) return;
    onActivityAdded(
      "calculator",
      `Hohmann Transfer Simulated: ${depAltitude}km to ${arrAltitude}km`,
    );
    setIsHohmannAnimating(true);
    setHohmannPhase("burn1");
    hohmannAngleRef.current = 0;
    setHohmannSimAngle(0);
    setHohmannTimeLeft(hohmann.transfer_time_s);
    setTimeout(() => setHohmannPhase("coasting"), 1500);
  };

  const handleStopHohmannTransfer = () => {
    setIsHohmannAnimating(false);
    setHohmannPhase("idle");
    hohmannAngleRef.current = 0;
  };

  const saveCircularNotes = () => {
    if (!circular) return;
    const { period, velocity, escape, energy } = circular;
    const title = `Earth Circular Orbit (${altitude} km)`;
    const content = `Central Body: Earth
Altitude: ${altitude} km
Semi-Major Axis (a): ${period.semi_major_axis_km.toFixed(2)} km

Orbital Velocity (${velocity.formula}): ${velocity.velocity_kms.toFixed(4)} km/s
Escape Velocity (${escape.formula}): ${escape.escape_velocity_kms.toFixed(4)} km/s
Orbital Period (${period.formula}): ${period.period_s.toFixed(2)} s (${period.period_min.toFixed(2)} min)
Specific Orbital Energy (${energy.formula}): ${energy.specific_energy_kms2.toFixed(4)} km²/s²`;
    onSaveNote({ type: "calculation", title, content });
    onActivityAdded("calculator", `Saved Orbit Parameters to Notes: ${title}`);
  };

  const saveHohmannNotes = () => {
    if (!hohmann) return;
    const title = `Earth Hohmann Transfer (${depAltitude}km -> ${arrAltitude}km)`;
    const content = `Central Body: Earth
Departure Altitude: ${depAltitude} km (r1 = ${hohmann.initial_radius_km.toFixed(2)} km)
Arrival Altitude: ${arrAltitude} km (r2 = ${hohmann.final_radius_km.toFixed(2)} km)

${hohmann.formula_delta_v1}
  Δv1 = ${hohmann.delta_v1_kms.toFixed(4)} km/s

${hohmann.formula_delta_v2}
  Δv2 = ${hohmann.delta_v2_kms.toFixed(4)} km/s

Total Δv = ${hohmann.dv_total_kms.toFixed(4)} km/s

${hohmann.formula_transfer_time}
  T = ${hohmann.transfer_time_s.toFixed(2)} s (${(hohmann.transfer_time_s / 3600).toFixed(2)} h)`;
    onSaveNote({ type: "calculation", title, content });
    onActivityAdded("calculator", `Saved Hohmann calculation to Notes`);
  };

  // ---------- SVG scaling (visual only) ----------
  const rForScale =
    circular?.period.semi_major_axis_km ?? EARTH_RADIUS_KM + altitude;
  const r1ForScale =
    hohmann?.initial_radius_km ?? EARTH_RADIUS_KM + depAltitude;
  const r2ForScale = hohmann?.final_radius_km ?? EARTH_RADIUS_KM + arrAltitude;
  const maxSimRadius = Math.max(rForScale, r2ForScale);
  const scaleRatio = 110 / maxSimRadius;
  const planetSvgRadius = Math.max(10, EARTH_RADIUS_KM * scaleRatio);
  const orbitSvgRadius = rForScale * scaleRatio;
  const depSvgRadius = r1ForScale * scaleRatio;
  const arrSvgRadius = r2ForScale * scaleRatio;

  const satX = 150 + Math.cos(simAngle) * orbitSvgRadius;
  const satY = 150 + Math.sin(simAngle) * orbitSvgRadius;

  const hohmannEccentricity =
    (r2ForScale - r1ForScale) / (r2ForScale + r1ForScale);
  const tx_a = ((r1ForScale + r2ForScale) / 2) * scaleRatio;
  const tx_b = tx_a * Math.sqrt(1 - Math.pow(hohmannEccentricity, 2));
  const tx_focus_offset = ((r2ForScale - r1ForScale) / 2) * scaleRatio;

  let hSatX = 150;
  let hSatY = 150;
  if (hohmannPhase === "burn1" || hohmannPhase === "idle") {
    hSatX = 150 + depSvgRadius;
    hSatY = 150;
  } else if (hohmannPhase === "coasting") {
    const rx =
      (((r1ForScale + r2ForScale) / 2) *
        (1 - Math.pow(hohmannEccentricity, 2))) /
      (1 + hohmannEccentricity * Math.cos(hohmannSimAngle));
    const scaledRx = rx * scaleRatio;
    hSatX = 150 + Math.cos(hohmannSimAngle) * scaledRx;
    hSatY = 150 + Math.sin(hohmannSimAngle) * scaledRx;
  } else if (hohmannPhase === "burn2" || hohmannPhase === "circular") {
    hSatX = 150 + Math.cos(hohmannSimAngle) * arrSvgRadius;
    hSatY = 150 + Math.sin(hohmannSimAngle) * arrSvgRadius;
  }

  // ---------- Render helpers ----------
  const periodMin = circular?.period.period_min ?? 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[calc(100vh-8rem)]">
      {/* Inputs and Calculations - Left Col */}
      <div className="lg:col-span-7 flex flex-col gap-6">
        {/* Core parameters */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-5 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Compass className="w-5 h-5 text-indigo-400" />
              <h3 className="font-display font-semibold text-white">
                Orbital Mechanics Setup
              </h3>
              {circularLoading && (
                <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
              )}
            </div>
            <div className="text-xs text-indigo-300 font-mono bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-full">
              Earth Gravitational Kernel Active
            </div>
          </div>

          {circularError && (
            <div className="flex items-start gap-2 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs font-mono">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{circularError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider font-mono">
                Central Celestial Body
              </label>
              <select
                value="Earth"
                disabled
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none opacity-90"
              >
                <option value="Earth">🌏 Earth</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider font-mono">
                Circular Alt. (km)
              </label>
              <input
                type="number"
                value={altitude}
                onChange={(e) =>
                  setAltitude(Math.max(0, parseInt(e.target.value) || 0))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none font-mono"
              />
            </div>

            <div className="flex flex-col justify-end">
              <span className="text-[10px] text-slate-500 font-mono">
                CELESTIAL CONSTANTS:
              </span>
              <span className="text-xs text-slate-300 font-mono mt-1">
                μ: 398,600.44 km³/s²
              </span>
              <span className="text-xs text-slate-300 font-mono">
                R: {EARTH_RADIUS_KM.toLocaleString()} km
              </span>
            </div>
          </div>

          {/* Computed values for Circular Orbits */}
          <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                Orbital Speed
              </p>
              <p className="text-lg font-bold text-emerald-400 font-mono mt-1">
                {circular ? circular.velocity.velocity_kms.toFixed(4) : "—"}{" "}
                <span className="text-xs font-normal text-slate-400">km/s</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                Escape velocity
              </p>
              <p className="text-lg font-bold text-cyan-400 font-mono mt-1">
                {circular
                  ? circular.escape.escape_velocity_kms.toFixed(4)
                  : "—"}{" "}
                <span className="text-xs font-normal text-slate-400">km/s</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                Orbital Period
              </p>
              <p className="text-lg font-bold text-amber-400 font-mono mt-1">
                {circular
                  ? periodMin > 120
                    ? `${(periodMin / 60).toFixed(2)} h`
                    : `${periodMin.toFixed(1)} m`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
                Specific Energy
              </p>
              <p className="text-lg font-bold text-rose-400 font-mono mt-1">
                {circular
                  ? circular.energy.specific_energy_kms2.toFixed(4)
                  : "—"}{" "}
                <span className="text-xs font-normal text-slate-400">
                  km²/s²
                </span>
              </p>
            </div>
          </div>

          {/* Formula step by step layout */}
          <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-800/60 flex flex-col gap-3 text-xs text-slate-400">
            <h4 className="font-display font-medium text-slate-200">
              Keplerian Circular Formula Breakdown
            </h4>
            {circular ? (
              <div className="space-y-2 font-mono">
                <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                  <span>Semi-major axis (a):</span>
                  <span className="text-slate-300">
                    R + h ={" "}
                    <strong className="text-indigo-400">
                      {circular.period.semi_major_axis_km.toFixed(3)} km
                    </strong>
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                  <span>Orbital velocity — {circular.velocity.formula}:</span>
                  <span className="text-slate-300">
                    a = {circular.velocity.semi_major_axis_km.toFixed(3)} ⇒{" "}
                    <strong className="text-emerald-400">
                      {circular.velocity.velocity_kms.toFixed(4)} km/s
                    </strong>
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                  <span>Escape speed — {circular.escape.formula}:</span>
                  <span className="text-slate-300">
                    a = {circular.escape.semi_major_axis_km.toFixed(3)} ⇒{" "}
                    <strong className="text-cyan-400">
                      {circular.escape.escape_velocity_kms.toFixed(4)} km/s
                    </strong>
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                  <span>Period — {circular.period.formula}:</span>
                  <span className="text-slate-300">
                    a = {circular.period.semi_major_axis_km.toFixed(3)} ⇒{" "}
                    <strong className="text-amber-400">
                      {circular.period.period_s.toFixed(2)} s
                    </strong>
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Specific energy — {circular.energy.formula}:</span>
                  <span className="text-slate-300">
                    a = {circular.energy.semi_major_axis_km.toFixed(3)} ⇒{" "}
                    <strong className="text-rose-400">
                      {circular.energy.specific_energy_kms2.toFixed(4)} km²/s²
                    </strong>
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-slate-500 font-mono text-xs">
                {circularLoading
                  ? "Solving on the science service…"
                  : "Awaiting valid altitude."}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={saveCircularNotes}
                disabled={!circular}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-all text-[11px] flex items-center gap-1.5 border border-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900"
              >
                <Save className="w-3.5 h-3.5" /> Save Parameters to Notes
              </button>
            </div>
          </div>
        </div>

        {/* Hohmann transfer card */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col gap-4 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-500" />
            <h3 className="font-display font-semibold text-white">
              Hohmann Transfer Trajectory
            </h3>
            {hohmannLoading && (
              <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            )}
          </div>

          {hohmannError && (
            <div className="flex items-start gap-2 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs font-mono">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{hohmannError}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider font-mono">
                Departure Alt (km)
              </label>
              <input
                type="number"
                value={depAltitude}
                onChange={(e) =>
                  setDepAltitude(Math.max(0, parseInt(e.target.value) || 0))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider font-mono">
                Arrival Alt (km)
              </label>
              <input
                type="number"
                value={arrAltitude}
                onChange={(e) =>
                  setArrAltitude(Math.max(0, parseInt(e.target.value) || 0))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800 grid grid-cols-2 sm:grid-cols-3 gap-4 text-center font-mono">
            <div>
              <p className="text-[10px] text-slate-500 uppercase">
                Departure Burn ΔV₁
              </p>
              <p className="text-md font-bold text-indigo-400 mt-1">
                {hohmann ? hohmann.delta_v1_kms.toFixed(4) : "—"} km/s
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase">
                Arrival Burn ΔV₂
              </p>
              <p className="text-md font-bold text-indigo-400 mt-1">
                {hohmann ? hohmann.delta_v2_kms.toFixed(4) : "—"} km/s
              </p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-[10px] text-slate-500 uppercase">
                Total Required ΔV
              </p>
              <p className="text-md font-bold text-emerald-400 mt-1">
                {hohmann ? hohmann.dv_total_kms.toFixed(4) : "—"} km/s
              </p>
            </div>
          </div>

          {hohmann ? (
            <div className="space-y-1.5 text-xs text-slate-400 font-mono bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60">
              <div className="flex justify-between">
                <span>Departure radius (r₁):</span>
                <span className="text-slate-300">
                  {hohmann.initial_radius_km.toFixed(3)} km
                </span>
              </div>
              <div className="flex justify-between">
                <span>Arrival radius (r₂):</span>
                <span className="text-slate-300">
                  {hohmann.final_radius_km.toFixed(3)} km
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-900 pt-1.5 mt-1">
                <span>{hohmann.formula_delta_v1}</span>
                <strong className="text-indigo-400">
                  {hohmann.delta_v1_kms.toFixed(4)} km/s
                </strong>
              </div>
              <div className="flex justify-between">
                <span>{hohmann.formula_delta_v2}</span>
                <strong className="text-indigo-400">
                  {hohmann.delta_v2_kms.toFixed(4)} km/s
                </strong>
              </div>
              <div className="flex justify-between">
                <span>{hohmann.formula_transfer_time}</span>
                <strong className="text-amber-400">
                  {(hohmann.transfer_time_s / 3600).toFixed(2)} h (
                  {(hohmann.transfer_time_s / 60).toFixed(1)} min)
                </strong>
              </div>
            </div>
          ) : (
            <div className="text-slate-500 font-mono text-xs bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60">
              {hohmannLoading
                ? "Solving Hohmann transfer on the science service…"
                : "Awaiting valid departure/arrival altitudes."}
            </div>
          )}

          <div className="flex justify-between items-center mt-2">
            {!isHohmannAnimating ? (
              <button
                onClick={handleStartHohmannTransfer}
                disabled={!hohmann}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-lg shadow-amber-600/10 transition-all disabled:opacity-40 disabled:hover:bg-amber-600"
              >
                <Flame className="w-4 h-4 text-white animate-pulse" /> Trigger
                Hohmann Transfer Animation
              </button>
            ) : (
              <button
                onClick={handleStopHohmannTransfer}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 transition-all"
              >
                <RotateCcw className="w-4 h-4" /> Stop & Reset Trajectory
              </button>
            )}

            <button
              onClick={saveHohmannNotes}
              disabled={!hohmann}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 rounded-lg transition-all text-[11px] flex items-center gap-1.5 disabled:opacity-40 disabled:hover:bg-slate-900"
            >
              <Save className="w-3.5 h-3.5" /> Save Hohmann Data
            </button>
          </div>
        </div>
      </div>

      {/* Orbit Visualization - Right Col */}
      <div className="lg:col-span-5 flex flex-col gap-6">
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col items-center justify-between gap-4 backdrop-blur-md flex-1">
          <div className="w-full flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Orbit className="w-5 h-5 text-indigo-400" />
              <h3 className="font-display font-semibold text-white">
                Interactive HUD Simulator
              </h3>
            </div>
            <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-slate-900"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div className="relative w-full aspect-square bg-slate-950 border border-slate-800/80 rounded-xl overflow-hidden shadow-inner flex items-center justify-center space-grid">
            <div className="absolute inset-0 pointer-events-none opacity-40">
              <div
                className="absolute top-8 left-1/4 w-1 h-1 bg-white rounded-full animate-ping"
                style={{ animationDuration: "3s" }}
              />
              <div className="absolute top-2/3 left-12 w-0.5 h-0.5 bg-indigo-300 rounded-full" />
              <div className="absolute top-1/2 right-12 w-1 h-1 bg-amber-200 rounded-full animate-pulse" />
              <div className="absolute bottom-12 right-1/3 w-0.5 h-0.5 bg-white rounded-full" />
            </div>

            <svg className="w-full h-full max-w-[360px]" viewBox="0 0 300 300">
              <circle
                cx="150"
                cy="150"
                r="50"
                fill="none"
                stroke="rgba(148, 163, 184, 0.04)"
                strokeDasharray="3,3"
              />
              <circle
                cx="150"
                cy="150"
                r="90"
                fill="none"
                stroke="rgba(148, 163, 184, 0.04)"
                strokeDasharray="3,3"
              />
              <circle
                cx="150"
                cy="150"
                r="130"
                fill="none"
                stroke="rgba(148, 163, 184, 0.04)"
                strokeDasharray="3,3"
              />

              {!isHohmannAnimating && (
                <circle
                  cx="150"
                  cy="150"
                  r={orbitSvgRadius}
                  fill="none"
                  stroke="rgba(99, 102, 241, 0.25)"
                  strokeWidth="1.5"
                />
              )}

              {isHohmannAnimating && (
                <>
                  <circle
                    cx="150"
                    cy="150"
                    r={depSvgRadius}
                    fill="none"
                    stroke="rgba(99, 102, 241, 0.3)"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  <circle
                    cx="150"
                    cy="150"
                    r={arrSvgRadius}
                    fill="none"
                    stroke="rgba(16, 185, 129, 0.3)"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                  {(hohmannPhase === "coasting" ||
                    hohmannPhase === "burn1") && (
                    <ellipse
                      cx={150 - tx_focus_offset}
                      cy={150}
                      rx={tx_a}
                      ry={tx_b}
                      fill="none"
                      stroke="rgba(245, 158, 11, 0.5)"
                      strokeWidth="1.5"
                      strokeDasharray="4,4"
                    />
                  )}
                </>
              )}

              <circle
                cx="150"
                cy="150"
                r={planetSvgRadius}
                fill="#38bdf8"
                className="shadow-lg filter drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]"
              />
              <circle
                cx="150"
                cy="150"
                r={planetSvgRadius * 0.75}
                fill="rgba(0, 0, 0, 0.15)"
              />

              {!isHohmannAnimating && (
                <g>
                  <circle
                    cx={satX}
                    cy={satY}
                    r="4"
                    fill="#6366f1"
                    className="animate-pulse"
                  />
                  <circle
                    cx={satX}
                    cy={satY}
                    r="8"
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth="1"
                    opacity="0.6"
                    className="animate-ping"
                    style={{ animationDuration: "2s" }}
                  />
                </g>
              )}

              {isHohmannAnimating && (
                <g>
                  <circle
                    cx={hSatX}
                    cy={hSatY}
                    r="5"
                    fill={
                      hohmannPhase === "coasting"
                        ? "#f59e0b"
                        : hohmannPhase === "circular"
                          ? "#10b981"
                          : "#6366f1"
                    }
                  />
                  {(hohmannPhase === "burn1" || hohmannPhase === "burn2") && (
                    <circle
                      cx={hSatX}
                      cy={hSatY}
                      r="12"
                      fill="none"
                      stroke="#f97316"
                      strokeWidth="2.5"
                      className="animate-ping"
                    />
                  )}
                </g>
              )}
            </svg>

            <div className="absolute bottom-3 left-3 bg-slate-950/90 border border-slate-800 p-2.5 rounded-lg text-[10px] font-mono text-slate-400 flex flex-col gap-1">
              <div className="flex justify-between gap-4">
                <span>SIM STATE:</span>
                <span
                  className={isPlaying ? "text-emerald-400" : "text-rose-400"}
                >
                  {isPlaying ? "ACTIVE" : "PAUSED"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span>WARP FACTOR:</span>
                <span className="text-cyan-400">{simSpeed}X SEC</span>
              </div>
              {isHohmannAnimating && (
                <div className="flex justify-between gap-4 border-t border-slate-900 pt-1 mt-1 font-semibold">
                  <span>TRANSFER PHASE:</span>
                  <span className="text-amber-400 uppercase">
                    {hohmannPhase}
                  </span>
                </div>
              )}
            </div>

            {isHohmannAnimating && hohmannPhase === "coasting" && (
              <div className="absolute top-3 left-3 bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 rounded-lg font-mono text-xs text-amber-400">
                🚀 Coasting TOF Timeleft: {(hohmannTimeLeft / 60).toFixed(1)}{" "}
                mins
              </div>
            )}
          </div>

          <div className="w-full">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-medium text-slate-400 font-mono">
                SIMULATION TIME SLIDER
              </span>
              <span className="text-xs font-bold text-slate-200 font-mono">
                {simSpeed}x warp
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="1000"
              value={simSpeed}
              onChange={(e) => setSimSpeed(parseInt(e.target.value))}
              className="w-full accent-indigo-500 bg-slate-950 rounded-lg cursor-pointer h-1.5"
            />
            <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
              <span>Realtime</span>
              <span>GEO Warp (1000x)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
