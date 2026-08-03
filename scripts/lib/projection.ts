/**
 * Natural Earth projection (Patterson) — a compromise projection designed for world maps.
 * Shared so the geometry build and the event placement cannot drift apart.
 */
export function projectNaturalEarth(lonDeg: number, latDeg: number): [number, number] {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const p2 = lat * lat;
  const p4 = p2 * p2;
  const p6 = p4 * p2;
  const p8 = p6 * p2;
  const p10 = p8 * p2;
  const p12 = p10 * p2;

  const x = lon * (0.8707 - 0.131979 * p2 - 0.013791 * p4 + 0.003971 * p10 - 0.001529 * p12);
  const y = lat * (1.007226 + 0.015085 * p2 - 0.044475 * p6 + 0.028874 * p8 - 0.005916 * p10);
  return [x, y];
}

export const X_MAX = projectNaturalEarth(180, 0)[0];
export const Y_MAX = projectNaturalEarth(0, 90)[1];

export const VIEW_WIDTH = 1000;
export const VIEW_HEIGHT = (VIEW_WIDTH * Y_MAX) / X_MAX;

export function toView(lon: number, lat: number): [number, number] {
  const [x, y] = projectNaturalEarth(lon, lat);
  return [((x / X_MAX) * 0.5 + 0.5) * VIEW_WIDTH, (0.5 - (y / Y_MAX) * 0.5) * VIEW_HEIGHT];
}
