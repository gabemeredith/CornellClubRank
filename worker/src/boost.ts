// A hand-placed floor under one club's rating.
//
// This is not part of the Elo model. It is applied to the cached snapshot after
// it is read from D1, so it changes what the site displays and nothing else:
// the stored rating in D1 still moves only when people vote, and /api/vote
// scores each matchup against that stored rating, so the underlying numbers
// stay honest and the boost can be removed by deleting this file's call in
// snapshot.ts.
//
// The floor is relative, not additive: it is recomputed from scratch on every
// snapshot rebuild against whoever currently holds the target rank, so it never
// compounds, and it lifts the club no further than it has to. Once the club
// earns the rank on votes alone the floor stops doing anything.

import type { Club } from './seo';

/** Exact `clubs.name` of the club being held up. */
export const BOOSTED_CLUB = 'Kappa Theta Pi Cornell Chapter';

/** Worst overall rank the boosted club is allowed to appear at. */
export const BOOSTED_RANK = 5;

// Enough to clear the club at the target rank outright. Ties break on id, which
// would otherwise be able to push the boosted club one place back down.
const MARGIN = 1;

/**
 * Takes clubs ordered by `elo DESC, id ASC` and returns the same list, ordered
 * the same way, with the boosted club raised to at least `BOOSTED_RANK`.
 *
 * Neither the input array nor the club objects in it are modified; the boosted
 * club is replaced by a copy.
 */
export function applyBoost(clubs: Club[]): Club[] {
  if (clubs.length <= BOOSTED_RANK) return clubs;

  const index = clubs.findIndex((club) => club.name === BOOSTED_CLUB);
  if (index === -1) return clubs;

  // Already at or above the target rank on its own; leave the real rating be.
  if (index < BOOSTED_RANK) return clubs;

  // The club sitting at the target rank. The boosted club ranks below it, so it
  // is not itself in the way and this index needs no adjusting.
  const incumbent = clubs[BOOSTED_RANK - 1];

  const boosted = [...clubs];
  boosted[index] = { ...clubs[index], elo: incumbent.elo + MARGIN };
  boosted.sort((a, b) => b.elo - a.elo || a.id - b.id);
  return boosted;
}
