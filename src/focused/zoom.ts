/** Local video magnification only: never sends camera/PTZ commands. */
export interface ZoomPoint {
  x: number;
  y: number;
}
export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}
export const initialZoom = (): ZoomState => ({ scale: 1, x: 0, y: 0 });
export function clampZoom(state: ZoomState, width: number, height: number): ZoomState {
  const scale = Math.min(5, Math.max(1, state.scale));
  const limitX = (width * (scale - 1)) / 2;
  const limitY = (height * (scale - 1)) / 2;
  return {
    scale,
    x: Math.max(-limitX, Math.min(limitX, state.x)),
    y: Math.max(-limitY, Math.min(limitY, state.y)),
  };
}
export function moveZoom(
  start: ZoomState,
  before: ZoomPoint[],
  after: ZoomPoint[],
  width: number,
  height: number,
): ZoomState {
  if (!before.length || before.length !== after.length) return start;
  if (before.length === 1)
    return clampZoom(
      {
        ...start,
        x: start.x + after[0].x - before[0].x,
        y: start.y + after[0].y - before[0].y,
      },
      width,
      height,
    );
  const distance = (p: ZoomPoint[]) => Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
  if (distance(before) < 1) return start;
  const center = (p: ZoomPoint[]) => ({
    x: (p[0].x + p[1].x) / 2 - width / 2,
    y: (p[0].y + p[1].y) / 2 - height / 2,
  });
  const a = center(before),
    b = center(after);
  const scale = Math.min(
    5,
    Math.max(1, (start.scale * distance(after)) / distance(before)),
  );
  const ratio = scale / start.scale;
  return clampZoom(
    { scale, x: b.x - (a.x - start.x) * ratio, y: b.y - (a.y - start.y) * ratio },
    width,
    height,
  );
}
