export interface Point { x: number; y: number }

/**
 * Scales a hand's points (0..1 across the camera frame, frame width/height = `aspect`) to fill
 * a `width` x `height` box, keeping the hand's own proportions and leaving `padding` on every
 * side. The hand is centered, so it reads the same size however far it is from the camera.
 */
export function fitToBox(points: ReadonlyArray<Point>, aspect: number, width: number, height: number, padding: number): Point[] {
  if (points.length === 0) return [];
  // Into square units first, so a hand isn't stretched by the camera's shape.
  const px = points.map(p => ({ x: p.x * aspect, y: p.y }));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of px) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const scale = Math.min((width - 2 * padding) / Math.max(maxX - minX, 1e-6), (height - 2 * padding) / Math.max(maxY - minY, 1e-6));
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return px.map(p => ({ x: width / 2 + (p.x - cx) * scale, y: height / 2 + (p.y - cy) * scale }));
}
