"use client";
import { useEffect, useRef } from "react";

/**
 * The hero visual: threads streaming in from every edge and tying off in a
 * gold knot at the centre. Canvas, devicePixelRatio-aware, paused when off
 * screen, and a single still frame under prefers-reduced-motion.
 */
export function ThreadBurst({ density = 260, knot = true, className = "" }: { density?: number; knot?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let maxR = 0;
    let raf = 0;
    let visible = true;

    type S = { a: number; r: number; v: number; len: number; width: number; color: string };
    const COLORS = ["rgba(46,230,200,", "rgba(46,230,200,", "rgba(255,255,255,", "rgba(130,160,175,", "rgba(15,168,143,"];
    const spawn = (fresh: boolean): S => ({
      a: Math.random() * Math.PI * 2,
      r: fresh ? maxR * (0.15 + Math.random() * 0.95) : maxR * (0.95 + Math.random() * 0.2),
      v: 0.35 + Math.random() * 1.4,
      len: 20 + Math.random() * 140,
      width: 1 + Math.random() * (Math.random() < 0.15 ? 14 : 4),
      color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    });
    let streaks: S[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      maxR = Math.hypot(w, h) / 2;
      streaks = Array.from({ length: density }, () => spawn(true));
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const hole = Math.min(w, h) * 0.12;
      for (const s of streaks) {
        if (!reduced) {
          // Faster as they near the knot: threads being drawn in.
          s.r -= s.v * (1 + (maxR - s.r) / maxR);
          if (s.r < hole) Object.assign(s, spawn(false));
        }
        const r0 = Math.max(s.r, hole);
        const r1 = Math.min(s.r + s.len, maxR * 1.2);
        const fade = Math.min(1, (s.r - hole) / (maxR * 0.25)) * 0.9;
        const cos = Math.cos(s.a);
        const sin = Math.sin(s.a);
        ctx.strokeStyle = `${s.color}${Math.max(0, fade).toFixed(3)})`;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        ctx.moveTo(cx + cos * r0, cy + sin * r0);
        ctx.lineTo(cx + cos * r1, cy + sin * r1);
        ctx.stroke();
      }
      if (knot) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, hole * 1.4);
        g.addColorStop(0, "rgba(242,184,75,0.95)");
        g.addColorStop(0.18, "rgba(242,184,75,0.55)");
        g.addColorStop(0.45, "rgba(242,184,75,0.08)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, hole * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduced && visible) raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = !!e?.isIntersecting;
      if (visible && !was && !reduced) raf = requestAnimationFrame(draw);
    });
    io.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [density, knot]);

  return <canvas ref={ref} className={`h-full w-full ${className}`} aria-hidden />;
}
