"use client";

import { useEffect, useRef } from "react";

interface P3D { x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number; ci: number; alpha: number; born: number; }

const RGBA = [
  [56, 189, 248],   // blue
  [34, 211, 238],   // cyan
  [167, 139, 250],  // purple
  [52, 211, 153],   // green
  [244, 114, 182],  // pink
] as const;

const HEX = ["#38bdf8", "#22d3ee", "#a78bfa", "#34d399", "#f472b6"];

export function DataOrb({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const ps = useRef<P3D[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!active) {
      cancelAnimationFrame(animRef.current);
      ps.current = [];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const W = (canvas.width = canvas.offsetWidth);
    const H = (canvas.height = canvas.offsetHeight);
    const cx = W / 2, cy = H / 2;
    const now = performance.now();
    startRef.current = now;

    ps.current = Array.from({ length: 140 }, () => {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 0.5 + Math.random() * 1.4;
      return {
        x: 0, y: 0, z: 0,
        vx: Math.sin(phi) * Math.cos(theta) * speed,
        vy: Math.sin(phi) * Math.sin(theta) * speed,
        vz: Math.cos(phi) * speed,
        r: 1.2 + Math.random() * 2.2,
        ci: Math.floor(Math.random() * RGBA.length),
        alpha: 0,
        born: now + Math.random() * 400,
      };
    });

    let rot = 0;

    function frame(ts: number) {
      ctx!.clearRect(0, 0, W, H);
      const elapsed = ts - startRef.current;
      rot += 0.005;
      const cosA = Math.cos(rot), sinA = Math.sin(rot);

      // central orb
      const orbR = 18 + 3 * Math.sin(elapsed * 0.0022);
      const og = ctx!.createRadialGradient(cx, cy, 0, cx, cy, orbR);
      og.addColorStop(0, "rgba(56,189,248,0.9)");
      og.addColorStop(0.6, "rgba(56,189,248,0.3)");
      og.addColorStop(1, "rgba(56,189,248,0)");
      ctx!.beginPath(); ctx!.arc(cx, cy, orbR, 0, Math.PI * 2);
      ctx!.fillStyle = og; ctx!.fill();

      // pulse ring
      const rr = orbR + 10 + 5 * Math.sin(elapsed * 0.003);
      ctx!.beginPath(); ctx!.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx!.strokeStyle = `rgba(56,189,248,${0.12 + 0.08 * Math.sin(elapsed * 0.003)})`;
      ctx!.lineWidth = 1; ctx!.stroke();

      // project particles
      type Proj = { sx: number; sy: number; a: number; ci: number; r: number };
      const proj: Proj[] = [];

      for (const p of ps.current) {
        if (ts < p.born) continue;
        const age = ts - p.born;
        p.alpha = Math.min(1, age / 450);

        p.vx *= 0.991; p.vy *= 0.991; p.vz *= 0.991;
        p.x += p.vx; p.y += p.vy; p.z += p.vz;

        // rotate around Y axis
        const rx = p.x * cosA - p.z * sinA;
        const rz = p.x * sinA + p.z * cosA;
        const fov = 280;
        const sc = fov / (fov + rz);
        const sx = cx + rx * sc * 1.9;
        const sy = cy + p.y * sc * 1.9;

        const d = Math.hypot(sx - cx, sy - cy);
        const maxD = Math.min(W, H) * 0.46;
        if (d > maxD * 1.2) { p.alpha *= 0.92; }

        const eff = p.alpha * Math.max(0, 1 - d / maxD) * (0.4 + 0.6 * sc);
        proj.push({ sx, sy, a: eff, ci: p.ci, r: p.r });
      }

      // connections
      for (let i = 0; i < proj.length; i++) {
        for (let j = i + 1; j < proj.length; j++) {
          const a = proj[i], b = proj[j];
          const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
          if (d < 65) {
            const alpha = (1 - d / 65) * Math.min(a.a, b.a) * 0.3;
            if (alpha < 0.01) continue;
            ctx!.beginPath();
            ctx!.moveTo(a.sx, a.sy);
            ctx!.lineTo(b.sx, b.sy);
            ctx!.strokeStyle = `rgba(56,189,248,${alpha.toFixed(3)})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }

      // dots
      for (const p of proj) {
        if (p.a < 0.02) continue;
        const [r, g, b] = RGBA[p.ci];
        ctx!.save();
        ctx!.globalAlpha = p.a;
        ctx!.beginPath();
        ctx!.arc(p.sx, p.sy, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = HEX[p.ci];
        ctx!.shadowBlur = 10;
        ctx!.shadowColor = `rgb(${r},${g},${b})`;
        ctx!.fill();
        ctx!.restore();
      }

      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: active ? 1 : 0, transition: "opacity 0.6s" }}
    />
  );
}
