// Manual ranking overrides.
//
// A table of minimum ranks, applied to the cached snapshot once it has been
// read from D1. This is display only: stored ratings still move only when
// people vote, and /api/vote scores every matchup against the stored value, so
// the underlying numbers stay untouched and emptying the table below turns the
// whole thing off.
//
// Each entry is a floor rather than a bonus. It is recomputed from scratch on
// every snapshot rebuild against whoever currently holds the target rank, so it
// never compounds, it lifts a club no further than it has to, and it stops
// doing anything at all once that club holds the rank on its own.

import type { Club } from './seo';

/** `clubs.name` -> the worst overall rank that club may appear at. */
export const RANK_FLOORS: Record<string, number> = {
  'Kappa Theta Pi Cornell Chapter': 5,
};

// Enough to clear the club at the target rank outright. Ties break on id, which
// would otherwise be able to push a floored club one place back down.
const MARGIN = 1;

/**
 * Takes clubs ordered by `elo DESC, id ASC` and returns the same list, ordered
 * the same way, with every floor in `floors` satisfied.
 *
 * Neither the input array nor the club objects in it are modified; a floored
 * club is replaced by a copy.
 */
export function applyRankFloors(clubs: Club[], floors: Record<string, number> = RANK_FLOORS): Club[] {
  // Shallowest rank first, so a deeper floor settles around the clubs already
  // placed above it rather than the other way round. Each floor is still worked
  // out on its own, so two floors aimed at neighbouring ranks can jostle each
  // other by a place; space them out if the table ever holds more than one.
  const ordered = Object.entries(floors).sort(([, a], [, b]) => a - b);
  let out = clubs;
  for (const [name, rank] of ordered) out = applyFloor(out, name, rank);
  return out;
}

function applyFloor(clubs: Club[], name: string, rank: number): Club[] {
  if (clubs.length <= rank) return clubs;

  const index = clubs.findIndex((club) => club.name === name);
  if (index === -1) return clubs;

  // Already at or above the floor on its own; leave the real rating be.
  if (index < rank) return clubs;

  // The club sitting at the target rank. The floored club ranks below it, so it
  // is not itself in the way and this index needs no adjusting.
  const incumbent = clubs[rank - 1];

  const next = [...clubs];
  next[index] = { ...clubs[index], elo: incumbent.elo + MARGIN };
  next.sort((a, b) => b.elo - a.elo || a.id - b.id);
  return next;
}
