"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Move } from "lucide-react";
import type { Direction, SlabInput, SlabResult } from "@/lib/slab/design";

/** Camera describes the view centre (world mm) and zoom (world units / pixel). */
interface Camera {
  cx: number;
  cy: number;
  upp: number;
}

/** Resolved view box in world (millimetre) coordinates. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  input: SlabInput;
  result: SlabResult;
  units: "mm" | "m";
  onOpenSection: (direction: Direction) => void;
}

const PAD = 1.35; // fraction of extra space around the slab on fit

function fmtLen(mm: number, units: "mm" | "m") {
  return units === "m" ? `${(mm / 1000).toFixed(mm % 1000 === 0 ? 0 : 2)} m` : `${Math.round(mm)} mm`;
}

/**
 * Interactive plan view of the slab. Supports wheel-zoom about the cursor and
 * drag-to-pan with either the middle mouse button (held) or the left button on
 * empty space. The view box is *derived* from a camera and the measured
 * container so the world→pixel mapping stays linear (no letterboxing) — a null
 * camera means "auto-fit", which the Fit button restores.
 *
 * The plan is deliberately clean: slab, columns, dimensions, and the two section
 * cut lines. All heavy design detail lives in the section view.
 */
export function SlabCanvas({ input, result, units, onOpenSection }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [camera, setCamera] = useState<Camera | null>(null);
  const pan = useRef<{ active: boolean; sx: number; sy: number; cx: number; cy: number; upp: number }>({
    active: false,
    sx: 0,
    sy: 0,
    cx: 0,
    cy: 0,
    upp: 1,
  });

  // Measure the container (ResizeObserver setState lives in a callback — fine).
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const box = useMemo<Box>(() => {
    const { w: W, h: H } = size;
    if (camera) {
      const w = camera.upp * W;
      const h = camera.upp * H;
      return { x: camera.cx - w / 2, y: camera.cy - h / 2, w, h };
    }
    // Auto-fit: smallest zoom that contains the padded slab in both axes.
    const upp = Math.max((input.lx * PAD) / W, (input.ly * PAD) / H);
    const w = upp * W;
    const h = upp * H;
    return { x: input.lx / 2 - w / 2, y: input.ly / 2 - h / 2, w, h };
  }, [camera, size, input.lx, input.ly]);

  const upp = box.w / size.w; // world units per screen pixel

  // Wheel zoom is attached natively (non-passive) so preventDefault actually
  // stops the page from scrolling while zooming — React's onWheel is passive.
  const wheelFn = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelFn.current = (e: WheelEvent) => {
      e.preventDefault();
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      const anchorX = box.x + fx * box.w;
      const anchorY = box.y + fy * box.h;
      const f = e.deltaY < 0 ? 0.88 : 1 / 0.88;
      const newUpp = Math.min(Math.max(upp * f, (input.lx * 0.15) / size.w), (input.lx * 6) / size.w);
      const newW = newUpp * size.w;
      const newH = newUpp * size.h;
      setCamera({ cx: anchorX + newW * (0.5 - fx), cy: anchorY + newH * (0.5 - fy), upp: newUpp });
    };
  });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => wheelFn.current(e);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      // Middle button (1) always pans; left button (0) pans the empty canvas.
      if (e.button !== 0 && e.button !== 1) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      pan.current = {
        active: true,
        sx: e.clientX,
        sy: e.clientY,
        cx: box.x + box.w / 2,
        cy: box.y + box.h / 2,
        upp,
      };
    },
    [box.x, box.y, box.w, box.h, upp],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const p = pan.current;
    if (!p.active) return;
    setCamera({ cx: p.cx - (e.clientX - p.sx) * p.upp, cy: p.cy - (e.clientY - p.sy) * p.upp, upp: p.upp });
  }, []);

  const endPan = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    pan.current.active = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }, []);

  const { lx, ly, columnSize: c } = input;
  const px = (n: number) => n * upp; // screen px -> world units at current zoom
  const font = px(12);
  const smallFont = px(10.5);

  // Faint 1 m grid across the visible box.
  const gridLines: React.ReactNode[] = [];
  const g0x = Math.floor(box.x / 1000) * 1000;
  const g0y = Math.floor(box.y / 1000) * 1000;
  for (let gx = g0x; gx <= box.x + box.w; gx += 1000) {
    gridLines.push(
      <line key={`gx${gx}`} x1={gx} y1={box.y} x2={gx} y2={box.y + box.h} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />,
    );
  }
  for (let gy = g0y; gy <= box.y + box.h; gy += 1000) {
    gridLines.push(
      <line key={`gy${gy}`} x1={box.x} y1={gy} x2={box.x + box.w} y2={gy} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />,
    );
  }

  const columns: { cx: number; cy: number }[] = [
    { cx: 0, cy: 0 },
    { cx: lx, cy: 0 },
    { cx: 0, cy: ly },
    { cx: lx, cy: ly },
  ];

  // Section cut lines: A–A runs along the X span (drawn horizontally at mid-Y),
  // B–B runs along the Y span (drawn vertically at mid-X).
  const cutA = ly / 2;
  const cutB = lx / 2;
  const tick = px(9);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <svg
        data-slab-canvas
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid slice"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerLeave={endPan}
        onMouseDown={(e) => {
          // Stop the browser's middle-click autoscroll from hijacking the pan.
          if (e.button === 1) e.preventDefault();
        }}
      >
        {gridLines}

        {/* Slab */}
        <rect x={0} y={0} width={lx} height={ly} fill="var(--accent)" fillOpacity={0.06} stroke="var(--accent)" strokeOpacity={0.5} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

        {/* Columns (centred on the grid intersections) */}
        {columns.map((col, i) => (
          <rect
            key={i}
            x={col.cx - c / 2}
            y={col.cy - c / 2}
            width={c}
            height={c}
            rx={px(2)}
            fill="var(--accent)"
            fillOpacity={0.85}
            stroke="var(--color-white)"
            strokeOpacity={0.25}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Section cut A–A (X span) */}
        <g onClick={() => onOpenSection("x")} style={{ cursor: "pointer" }}>
          <line x1={-px(30)} y1={cutA} x2={lx + px(30)} y2={cutA} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray={`${px(10)} ${px(5)} ${px(2)} ${px(5)}`} vectorEffect="non-scaling-stroke" />
          <line x1={-px(30)} y1={cutA} x2={-px(30)} y2={cutA - tick * 1.6} stroke="#f59e0b" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <line x1={lx + px(30)} y1={cutA} x2={lx + px(30)} y2={cutA - tick * 1.6} stroke="#f59e0b" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <text x={-px(30)} y={cutA - tick * 2.2} fontSize={font} fill="#f59e0b" textAnchor="middle" fontWeight={700}>A</text>
          <text x={lx + px(30)} y={cutA - tick * 2.2} fontSize={font} fill="#f59e0b" textAnchor="middle" fontWeight={700}>A</text>
        </g>

        {/* Section cut B–B (Y span) */}
        <g onClick={() => onOpenSection("y")} style={{ cursor: "pointer" }}>
          <line x1={cutB} y1={-px(30)} x2={cutB} y2={ly + px(30)} stroke="#22d3ee" strokeWidth={1.5} strokeDasharray={`${px(10)} ${px(5)} ${px(2)} ${px(5)}`} vectorEffect="non-scaling-stroke" />
          <line x1={cutB} y1={-px(30)} x2={cutB + tick * 1.6} y2={-px(30)} stroke="#22d3ee" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <line x1={cutB} y1={ly + px(30)} x2={cutB + tick * 1.6} y2={ly + px(30)} stroke="#22d3ee" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <text x={cutB + tick * 2.4} y={-px(30) + smallFont / 2} fontSize={font} fill="#22d3ee" textAnchor="middle" fontWeight={700}>B</text>
          <text x={cutB + tick * 2.4} y={ly + px(30) + smallFont / 2} fontSize={font} fill="#22d3ee" textAnchor="middle" fontWeight={700}>B</text>
        </g>

        {/* Dimensions */}
        <text x={lx / 2} y={ly + px(26)} fontSize={font} fill="var(--muted-foreground)" textAnchor="middle">
          Lx = {fmtLen(lx, units)}
        </text>
        <text x={-px(20)} y={ly / 2} fontSize={font} fill="var(--muted-foreground)" textAnchor="middle" transform={`rotate(-90 ${-px(20)} ${ly / 2})`}>
          Ly = {fmtLen(ly, units)}
        </text>
      </svg>

      {/* Overlay controls */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
        <div className="flex items-start justify-between gap-2">
          <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel)]/80 px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] backdrop-blur">
            <Move className="h-3 w-3" /> Middle-drag or drag to pan · wheel to zoom
          </span>
          <button
            type="button"
            onClick={() => setCamera(null)}
            title="Fit to view"
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel)]/80 text-[var(--muted-foreground)] backdrop-blur transition hover:text-white"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => onOpenSection("x")}
            className="pointer-events-auto rounded-full border border-[#f59e0b]/40 bg-[#f59e0b]/10 px-3 py-1 font-medium text-[#f59e0b] transition hover:bg-[#f59e0b]/20"
          >
            Section A–A (Lx span) · {(result.x.columnStrip.utilisation * 100).toFixed(0)}%
          </button>
          <button
            type="button"
            onClick={() => onOpenSection("y")}
            className="pointer-events-auto rounded-full border border-[#22d3ee]/40 bg-[#22d3ee]/10 px-3 py-1 font-medium text-[#22d3ee] transition hover:bg-[#22d3ee]/20"
          >
            Section B–B (Ly span) · {(result.y.columnStrip.utilisation * 100).toFixed(0)}%
          </button>
        </div>
      </div>
    </div>
  );
}
