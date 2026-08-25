import { screen, Rectangle } from 'electron';
import type { WindowBounds } from './types';

interface DisplayInfo {
  id: number;
  workArea: Rectangle;
}

function getDisplays(): DisplayInfo[] {
  return screen.getAllDisplays().map(d => ({ id: d.id, workArea: d.workArea }));
}

function rectsOverlap(a: Rectangle, b: Rectangle): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function resolveWindowBounds(
  saved: WindowBounds | undefined,
  defaultWidth: number,
  defaultHeight: number,
): { x: number; y: number; width: number; height: number } {
  const displays = getDisplays();
  const primary = screen.getPrimaryDisplay();

  if (saved) {
    const winRect: Rectangle = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
    const validDisplay = displays.find(d => rectsOverlap(winRect, d.workArea));

    if (validDisplay) {
      return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
    }
  }

  const w = primary.workArea;
  return {
    x: Math.round(w.x + (w.width - defaultWidth) / 2),
    y: Math.round(w.y + (w.height - defaultHeight) / 2),
    width: defaultWidth,
    height: defaultHeight,
  };
}

export function getDisplayIdForWindow(x: number, y: number): number {
  const pt = { x, y };
  const display = screen.getDisplayNearestPoint(pt);
  return display.id;
}

export function constrainToDisplay(
  x: number, y: number,
  width: number, height: number,
): { x: number; y: number; width: number; height: number } {
  const display = screen.getDisplayNearestPoint({ x, y });
  const w = display.workArea;
  const cx = Math.max(w.x, Math.min(x, w.x + w.width - Math.min(width, 200)));
  const cy = Math.max(w.y, Math.min(y, w.y + w.height - Math.min(height, 100)));
  return { x: cx, y: cy, width, height };
}
