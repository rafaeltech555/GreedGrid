/**
 * A cell's id is derived from its top-left track coordinate (`c<col>-r<row>`).
 * Two distinct cells can never share a top-left track (that would mean overlap),
 * so this is collision-free, and it keeps geometry operations deterministic and
 * trivially unit-testable (no UUIDs needed for the grid structure itself).
 */
export function cellId(col: number, row: number): string {
  return `c${col}-r${row}`;
}
