// Unified mouse/touch board controls via Pointer Events: pan, pinch/wheel
// zoom, and tap detection.

import { useEffect } from "preact/hooks";
import { zoomAt, type Camera } from "../camera";
import type { Point } from "../hex";

export function usePointerControls(
  canvasRef: { current: HTMLCanvasElement | null },
  camRef: { current: Camera },
  onChange: () => void,
  onTap: (screenPt: Point) => void,
  blocked: () => boolean
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pointers = new Map<number, Point>();
    let lastSingle: Point | null = null;
    let startSingle: Point | null = null;
    let movedDist = 0;
    let pinchDist = 0;

    const local = (e: PointerEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        lastSingle = p;
        startSingle = p;
        movedDist = 0;
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        pinchDist = dist(pts[0], pts[1]);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      const p = local(e);
      pointers.set(e.pointerId, p);

      if (pointers.size === 1 && lastSingle) {
        const dx = p.x - lastSingle.x;
        const dy = p.y - lastSingle.y;
        movedDist += Math.hypot(dx, dy);
        if (!blocked()) {
          camRef.current = {
            ...camRef.current,
            x: camRef.current.x - dx / camRef.current.scale,
            y: camRef.current.y - dy / camRef.current.scale,
          };
          onChange();
        }
        lastSingle = p;
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const d = dist(pts[0], pts[1]);
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        if (pinchDist > 0 && !blocked()) {
          camRef.current = zoomAt(camRef.current, mid, d / pinchDist);
          onChange();
        }
        pinchDist = d;
        movedDist += 999; // a pinch is never a tap
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (wasSingle && startSingle && movedDist < 6) {
        onTap(startSingle);
      }
      if (pointers.size === 0) {
        lastSingle = null;
        startSingle = null;
      } else if (pointers.size === 1) {
        lastSingle = [...pointers.values()][0];
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (blocked()) return;
      const rect = canvas.getBoundingClientRect();
      const pivot = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      camRef.current = zoomAt(camRef.current, pivot, factor);
      onChange();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [canvasRef, camRef, onChange, onTap, blocked]);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
