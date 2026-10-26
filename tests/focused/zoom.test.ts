import { describe, expect, it } from 'vitest';
import { initialZoom, moveZoom, clampZoom } from '../../src/focused/zoom';
describe('video-only zoom geometry', () => {
  it('anchors the point between the fingers while increasing magnification', () => {
    expect(
      moveZoom(
        initialZoom(),
        [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
        ],
        [
          { x: 50, y: 100 },
          { x: 250, y: 100 },
        ],
        400,
        200,
      ),
    ).toEqual({ scale: 2, x: 50, y: 0 });
  });
  it('limits magnification and panning and returns to centered at 1x', () => {
    expect(clampZoom({ scale: 9, x: 9999, y: -9999 }, 400, 200)).toEqual({
      scale: 5,
      x: 800,
      y: -400,
    });
    expect(clampZoom({ scale: 0.5, x: 200, y: 300 }, 400, 200)).toEqual(initialZoom());
  });
  it('ignores incomplete or coincident gestures', () => {
    expect(moveZoom(initialZoom(), [], [], 400, 200)).toEqual(initialZoom());
    expect(
      moveZoom(
        initialZoom(),
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ],
        400,
        200,
      ),
    ).toEqual(initialZoom());
  });
});
