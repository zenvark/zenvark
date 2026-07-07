export type ObjectValues<T> = T[keyof T];

export type SemaphoreClassConfig = {
  /**
   * Fraction of the fleet-wide capacity (exclusive 0..1) that only this class
   * may occupy. Classes without a reservedShare compete for the remainder.
   */
  reservedShare?: number;
};

export type SemaphoreState = {
  /**
   * This process's cached view of the fleet-wide limit.
   */
  limit: number;

  /**
   * Number of leases currently held by this process (not fleet-wide).
   */
  inflight: number;

  /**
   * Per-class breakdown of this process's held leases. Leases acquired
   * without a class are counted in `inflight` only.
   */
  inflightByClass: Record<string, number>;
};
