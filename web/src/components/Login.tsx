import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

type Mode = "signin" | "signup";

interface Star {
  x: number;
  y: number;
  size: number;
  color: string;
  baseOpacity: number;
  amp: number;
  speed: number;
  phase: number;
  glow: boolean;
}

const STAR_COUNT = 110;
const STAR_TINTS = [
  "#ffffff",
  "#eaf0ff",
  "#cfe0ff",
  "#d6ffe8",
  "#e5dcff",
  "#f4f6ff",
];

function makeStars(w: number, h: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const size = 0.6 + Math.pow(Math.random(), 2.2) * 2.0;
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      size,
      color: STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)],
      baseOpacity: 0.35 + Math.random() * 0.5,
      amp: 0.15 + Math.random() * 0.35,
      speed: 0.4 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
      glow: size > 1.8,
    });
  }
  return stars;
}

export default function Login() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const skyRef = useRef<HTMLDivElement>(null);
  const planetRef = useRef<HTMLDivElement>(null);
  const starsRef = useRef<Star[]>([]);
  const nodesRef = useRef<HTMLSpanElement[]>([]);

  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    const sky = skyRef.current;
    if (!sky) return;

    const build = () => {
      sky.innerHTML = "";
      nodesRef.current = [];
      const w = sky.clientWidth;
      const h = sky.clientHeight;
      const stars = makeStars(w, h);
      starsRef.current = stars;
      const frag = document.createDocumentFragment();
      for (const s of stars) {
        const el = document.createElement("span");
        el.style.position = "absolute";
        el.style.left = `${s.x}px`;
        el.style.top = `${s.y}px`;
        el.style.width = `${s.size}px`;
        el.style.height = `${s.size}px`;
        el.style.borderRadius = "50%";
        el.style.background = s.color;
        el.style.opacity = String(s.baseOpacity);
        el.style.pointerEvents = "none";
        if (s.glow) {
          el.style.boxShadow = `0 0 ${4 + s.size * 3}px ${s.color}`;
        }
        frag.appendChild(el);
        nodesRef.current.push(el);
      }
      sky.appendChild(frag);
    };

    build();

    let raf = 0;
    const t0 = performance.now();
    const planet = planetRef.current;

    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      const stars = starsRef.current;
      const nodes = nodesRef.current;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const o = s.baseOpacity + s.amp * Math.sin(t * s.speed + s.phase);
        nodes[i].style.opacity = String(Math.max(0, Math.min(1, o)));
      }
      if (planet) {
        const bob = Math.sin(t * 0.45) * 8;
        planet.style.transform = `translate(-50%, calc(52% + ${bob}px))`;
      }
      raf = requestAnimationFrame(tick);
    };

    if (!reducedMotion) raf = requestAnimationFrame(tick);

    const onResize = () => build();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [reducedMotion]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        if (!data.session) {
          setInfo(
            "Check your email for a confirmation link to finish sign-up.",
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/app` },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed.");
      setBusy(false);
    }
  };

  const eyebrow: React.CSSProperties = {
    fontFamily: "'Space Mono', ui-monospace, monospace",
    fontSize: "10.5px",
    letterSpacing: "0.28em",
    textTransform: "uppercase",
    color: "#9aa0bd",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        color: "#eef0fb",
        fontFamily: "'Archivo', system-ui, sans-serif",
        background:
          "radial-gradient(125% 95% at 50% 0%, #0c1126 0%, #070a16 48%, #03040a 100%)",
      }}
    >
      <style>{`
        @keyframes _astro_none {}
        ::selection { background: rgba(94,242,168,.3); color: #06121a; }
        .astro-input::placeholder { color: #5c6180; }
        .astro-input:focus {
          border-color: rgba(139,108,255,.65) !important;
          box-shadow: 0 0 0 3px rgba(139,108,255,.18);
        }
        .astro-link { color: #8b6cff; text-decoration: none; transition: color .18s ease; }
        .astro-link:hover { color: #5ef2a8; }
        .astro-primary { transition: transform .18s ease, filter .18s ease; }
        .astro-primary:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
        .astro-ghost { transition: background .18s ease, border-color .18s ease; }
        .astro-ghost:hover:not(:disabled) {
          background: rgba(255,255,255,.07);
          border-color: rgba(255,255,255,.28);
        }
      `}</style>

      {/* Milky Way photo layer */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url('/assets/milkyway.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.35,
          mixBlendMode: "screen",
          filter: "blur(1px) saturate(1.1)",
          pointerEvents: "none",
        }}
      />

      {/* Aurora glows */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          bottom: "-30%",
          width: "120vw",
          height: "90vh",
          transform: "translateX(-50%)",
          background:
            "radial-gradient(closest-side, rgba(139,108,255,.34), transparent 70%)",
          filter: "blur(60px)",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "-20%",
          top: "-25%",
          width: "80vw",
          height: "80vh",
          background:
            "radial-gradient(closest-side, rgba(94,242,168,.2), transparent 70%)",
          filter: "blur(70px)",
          pointerEvents: "none",
        }}
      />

      {/* Planet (Neptune-like, rising from bottom) */}
      <div
        ref={planetRef}
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          bottom: "0",
          width: "min(1100px, 140vw)",
          height: "min(1100px, 140vw)",
          transform: "translate(-50%, 52%)",
          borderRadius: "50%",
          mixBlendMode: "screen",
          background:
            "radial-gradient(circle at 42% 38%, #7ea8ff 0%, #3a63c8 22%, #1d3577 46%, #0a1638 68%, #05081c 82%, #03050f 100%)",
          boxShadow:
            "inset -80px -140px 220px rgba(3,5,15,.85), inset 60px 40px 160px rgba(126,168,255,.18), 0 0 220px rgba(139,108,255,.35)",
          pointerEvents: "none",
        }}
      />

      {/* Star field (JS-generated <span>s, twinkle via rAF) */}
      <div
        ref={skyRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      />

      {/* Vignette */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(3,4,10,.65) 88%, rgba(3,4,10,.95) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Centered card */}
      <div
        style={{
          position: "relative",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "clamp(20px, 4vw, 48px)",
          zIndex: 5,
        }}
      >
        <div
          style={{
            width: "min(440px, 100%)",
            borderRadius: "22px",
            padding: "clamp(28px, 4vw, 42px)",
            background:
              "linear-gradient(180deg, rgba(14,17,34,.82), rgba(8,10,22,.86))",
            border: "1px solid rgba(139,108,255,.22)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            boxShadow:
              "0 30px 90px rgba(2,3,10,.7), 0 0 60px rgba(139,108,255,.12)",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              marginBottom: "28px",
            }}
          >
            <svg
              viewBox="0 0 32 32"
              style={{ width: 34, height: 34, flex: "none" }}
              aria-hidden
            >
              <circle
                cx="16"
                cy="16"
                r="7.5"
                fill="none"
                stroke="#eef0fb"
                strokeWidth="1.5"
              />
              <ellipse
                cx="16"
                cy="16"
                rx="14"
                ry="5"
                fill="none"
                stroke="#5ef2a8"
                strokeWidth="1.3"
                transform="rotate(-24 16 16)"
              />
              <circle cx="27.5" cy="9.5" r="1.6" fill="#8b6cff" />
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontFamily: "'Archivo Expanded', 'Archivo', sans-serif",
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontSize: "17px",
                  color: "#eef0fb",
                }}
              >
                Astro&nbsp;AI
              </span>
              <span style={{ ...eyebrow, fontSize: "10.5px" }}>
                {mode === "signin" ? "Re-enter the sky" : "Enlist a new cadet"}
              </span>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 18 }}
          >
            {/* Email */}
            <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={eyebrow}>Email</span>
              <div style={inputWrap}>
                <MailIcon />
                <input
                  className="astro-input"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@orbit.space"
                  style={inputStyle}
                />
              </div>
            </label>

            {/* Password */}
            <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={eyebrow}>Password</span>
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="astro-link"
                  style={{ ...eyebrow, color: "#8b6cff" }}
                >
                  Forgot?
                </a>
              </div>
              <div style={inputWrap}>
                <LockIcon />
                <input
                  className="astro-input"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={inputStyle}
                />
              </div>
            </label>

            {error && (
              <div
                style={alertStyle(
                  "#ff8a9a",
                  "rgba(255,90,120,.10)",
                  "rgba(255,90,120,.32)",
                )}
              >
                {error}
              </div>
            )}
            {info && (
              <div
                style={alertStyle(
                  "#a9f3cf",
                  "rgba(94,242,168,.10)",
                  "rgba(94,242,168,.32)",
                )}
              >
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="astro-primary"
              style={{
                marginTop: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                width: "100%",
                border: "none",
                cursor: busy ? "not-allowed" : "pointer",
                padding: "14px 22px",
                borderRadius: 100,
                fontFamily: "'Archivo', sans-serif",
                fontWeight: 700,
                fontSize: 14,
                letterSpacing: "0.02em",
                color: "#06121a",
                background: "linear-gradient(120deg, #8b6cff, #5ef2a8)",
                boxShadow: "0 10px 40px rgba(139,108,255,.35)",
                opacity: busy ? 0.75 : 1,
              }}
            >
              {busy ? (
                <span>Igniting…</span>
              ) : (
                <>
                  <span>
                    {mode === "signin" ? "Enter the sky" : "Create account"}
                  </span>
                  <ArrowInIcon />
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              margin: "22px 0",
            }}
          >
            <div
              style={{
                height: 1,
                flex: 1,
                background: "rgba(255,255,255,.10)",
              }}
            />
            <span style={{ ...eyebrow, fontSize: "10.5px" }}>Or</span>
            <div
              style={{
                height: 1,
                flex: 1,
                background: "rgba(255,255,255,.10)",
              }}
            />
          </div>

          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={busy}
            className="astro-ghost"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              padding: "13px 18px",
              borderRadius: 100,
              background: "rgba(255,255,255,.04)",
              border: "1px solid rgba(255,255,255,.16)",
              color: "#eef0fb",
              fontFamily: "'Archivo', sans-serif",
              fontWeight: 600,
              fontSize: 14,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* Footer switch */}
          <div
            style={{
              marginTop: 22,
              textAlign: "center",
              fontFamily: "'Archivo', sans-serif",
              fontSize: 13,
              color: "#9aa0bd",
            }}
          >
            {mode === "signin" ? (
              <>
                New here?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                    setInfo(null);
                  }}
                  className="astro-link"
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    font: "inherit",
                    color: "#8b6cff",
                    fontWeight: 600,
                  }}
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already a cadet?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                    setInfo(null);
                  }}
                  className="astro-link"
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    font: "inherit",
                    color: "#8b6cff",
                    fontWeight: 600,
                  }}
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* HUD chrome */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: "clamp(18px, 3vw, 36px)",
          bottom: "clamp(16px, 3vw, 28px)",
          zIndex: 6,
          ...eyebrow,
          fontSize: "10.5px",
          letterSpacing: "0.26em",
          color: "#9aa0bd",
        }}
      >
        <div style={{ color: "#eef0fb" }}>Mission control</div>
        <div style={{ marginTop: 4 }}>Secure channel · TLS</div>
      </div>
      <div
        aria-hidden
        style={{
          position: "fixed",
          right: "clamp(18px, 3vw, 36px)",
          bottom: "clamp(16px, 3vw, 28px)",
          zIndex: 6,
          textAlign: "right",
          ...eyebrow,
          fontSize: "10.5px",
          letterSpacing: "0.26em",
          color: "#9aa0bd",
        }}
      >
        <div style={{ color: "#eef0fb" }}>Est. 2026</div>
        <div style={{ marginTop: 4 }}>Low Earth Orbit</div>
      </div>
    </div>
  );
}

const inputWrap: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  background: "rgba(3,5,14,.6)",
  border: "1px solid rgba(255,255,255,.12)",
  borderRadius: 12,
  padding: "12px 14px",
  transition: "border-color .18s ease, box-shadow .18s ease",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  color: "#eef0fb",
  fontFamily: "'Archivo', sans-serif",
  fontSize: 14,
  letterSpacing: "0.01em",
};

function alertStyle(
  color: string,
  bg: string,
  border: string,
): React.CSSProperties {
  return {
    fontFamily: "'Space Mono', ui-monospace, monospace",
    fontSize: 11.5,
    letterSpacing: "0.06em",
    color,
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 10,
    padding: "10px 12px",
    lineHeight: 1.5,
  };
}

function MailIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#8b6cff"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#8b6cff"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}

function ArrowInIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#06121a"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h13" />
      <path d="M12 5l7 7-7 7" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.72 1.22 9.22 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.2C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.2C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
