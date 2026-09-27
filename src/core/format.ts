// Display formatting shared by the viewer, the floor plan and the quote.

/** Feet as a builder writes them: 12', 12'-6". Rounds to the nearest inch. */
export function feetInches(ft: number): string {
  const totalIn = Math.round(ft * 12);
  const whole = Math.floor(totalIn / 12);
  const inches = totalIn - whole * 12;
  return inches === 0 ? `${whole}'` : `${whole}'-${inches}"`;
}
