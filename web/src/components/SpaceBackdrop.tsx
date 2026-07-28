import { useEffect, useMemo, useRef } from "react";

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

const STAR_COUNT = 70;
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
    const size = 0.6 + Math.pow(Math.random(), 2.4) * 1.8;
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      size,
      color: STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)],
      baseOpacity: 0.28 + Math.random() * 0.5,
      amp: 0.12 + Math.random() * 0.3,
      speed: 0.35 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      glow: size > 1.6,
    });
  }
  return stars;
}

export default function SpaceBackdrop() {
  const skyRef = useRef<HTMLDivElement>(null);
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
          el.style.boxShadow = `0 0 ${3 + s.size * 2.5}px ${s.color}`;
        }
        frag.appendChild(el);
        nodesRef.current.push(el);
      }
      sky.appendChild(frag);
    };

    build();

    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      const stars = starsRef.current;
      const nodes = nodesRef.current;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const o = s.baseOpacity + s.amp * Math.sin(t * s.speed + s.phase);
        nodes[i].style.opacity = String(Math.max(0, Math.min(1, o)));
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

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        background:
          "radial-gradient(125% 95% at 50% 0%, #0c1126 0%, #070a16 48%, #03040a 100%)",
      }}
    >
      {/* Milky Way */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url('/assets/milkyway.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.22,
          mixBlendMode: "screen",
          filter: "blur(1px)",
        }}
      />
      {/* Violet aurora, bottom-right */}
      <div
        style={{
          position: "absolute",
          right: "-15%",
          bottom: "-40%",
          width: "120vh",
          height: "120vh",
          background:
            "radial-gradient(closest-side, rgba(139,108,255,.22), transparent 70%)",
          filter: "blur(30px)",
        }}
      />
      {/* Green aurora, top-left */}
      <div
        style={{
          position: "absolute",
          left: "-20%",
          top: "-25%",
          width: "80vw",
          height: "80vh",
          background:
            "radial-gradient(closest-side, rgba(94,242,168,.13), transparent 70%)",
          filter: "blur(44px)",
        }}
      />
      {/* Stars */}
      <div
        ref={skyRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
    </div>
  );
}
