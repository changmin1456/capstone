export function createPathFromPoints(values: number[], width = 280, height = 160, padding = 12): string {
  if (!values.length) return "";
  const xs = values.map((_, i) => i);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs) || 1;
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const rngY = maxY - minY || 1;

  const sx = (width - padding * 2) / (maxX - minX || 1);
  const sy = (height - padding * 2) / rngY;

  const toPoint = (i: number, v: number) => {
    const x = padding + (i - minX) * sx;
    const y = height - padding - (v - minY) * sy;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  return values.map((v, i) => toPoint(i, v)).join(" ");
}
