// Unified mouse/touch board controls via Pointer Events: pan, pinch/wheel
// zoom, tap and long-press detection. Pan/wheel speeds honor the camera
// sensitivity setting (the original's "sensitivity" preference).

import { useEffect } from "preact/hooks";
import { zoomAt, type Camera } from "../camera";
import type { Point } from "../hex";
import { settings } from "../settings";

const LONG_PRESS_MS = 500; // original GameController.marchDelay

export function usePointerControls(
  canvasRef: { current: HTMLCanvasElement | null },
  camRef: { current: Camera },
  onChange: () => void,
  onTap: (screenPt: Point) => void,
  blocked: () => boolean,
  onLongPress?: (screenPt: Point) => void
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pointers = new Map<number, Point>();
    let lastSingle: Point | null = null;
    let startSingle: Point | null = null;
    let movedDist = 0;
    let pinchDist = 0;
    let pinchMid: Point | null = null;
    let longPressTimer = 0;

    const local = (e: PointerEvent): Point => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const cancelLongPress = () => {
      if (longPressTimer) {
        window.clearTimeout(longPressTimer);
        longPressTimer = 0;
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* Pointer capture is unavailable in some mobile webviews. */
      }
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        lastSingle = p;
        startSingle = p;
        movedDist = 0;
        if (onLongPress) {
          cancelLongPress();
          longPressTimer = window.setTimeout(() => {
            longPressTimer = 0;
            if (pointers.size === 1 && movedDist < 6 && startSingle && !blocked()) {
              movedDist += 999; // a long press is never a tap
              onLongPress(startSingle);
            }
          }, LONG_PRESS_MS);
        }
      } else if (pointers.size === 2) {
        cancelLongPress();
        const pts = [...pointers.values()];
        pinchDist = dist(pts[0], pts[1]);
        pinchMid = midpoint(pts[0], pts[1]);
        movedDist += 999; // a multi-touch gesture is never a tap
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      const p = local(e);
      pointers.set(e.pointerId, p);

      if (pointers.size === 1 && lastSingle) {
        const sens = settings.cameraSensitivity || 1;
        const dx = p.x - lastSingle.x;
        const dy = p.y - lastSingle.y;
        movedDist += Math.hypot(dx, dy);
        if (movedDist >= 6) cancelLongPress();
        if (!blocked()) {
          camRef.current = {
            ...camRef.current,
            x: camRef.current.x - (dx * sens) / camRef.current.scale,
            y: camRef.current.y - (dy * sens) / camRef.current.scale,
          };
          onChange();
        }
        lastSingle = p;
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const d = dist(pts[0], pts[1]);
        const mid = midpoint(pts[0], pts[1]);
        if (pinchDist > 0 && pinchMid && !blocked()) {
          const cam = camRef.current;
          const sens = settings.cameraSensitivity || 1;
          const movedCam: Camera = {
            ...cam,
            x: cam.x - ((mid.x - pinchMid.x) * sens) / cam.scale,
            y: cam.y - ((mid.y - pinchMid.y) * sens) / cam.scale,
          };
          camRef.current = zoomAt(movedCam, mid, d / pinchDist);
          onChange();
        }
        pinchDist = d;
        pinchMid = mid;
      }
    };

    const finishPointer = (e: PointerEvent, cancelled: boolean) => {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      cancelLongPress();
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (!cancelled && wasSingle && startSingle && movedDist < 6) {
        onTap(startSingle);
      }
      if (pointers.size === 0) {
        lastSingle = null;
        startSingle = null;
        pinchDist = 0;
        pinchMid = null;
      } else if (pointers.size === 1) {
        lastSingle = [...pointers.values()][0];
        startSingle = null;
        pinchDist = 0;
        pinchMid = null;
      }
    };

    const onUp = (e: PointerEvent) => finishPointer(e, false);
    const onCancel = (e: PointerEvent) => finishPointer(e, true);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (blocked()) return;
      const rect = canvas.getBoundingClientRect();
      const pivot = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? canvas.clientHeight
          : 1;
      const delta = Math.max(-240, Math.min(240, e.deltaY * unit));
      const factor = Math.exp(-delta * 0.0015 * (settings.cameraSensitivity || 1));
      camRef.current = zoomAt(camRef.current, pivot, factor);
      onChange();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelLongPress();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [canvasRef, camRef, onChange, onTap, blocked, onLongPress]);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
