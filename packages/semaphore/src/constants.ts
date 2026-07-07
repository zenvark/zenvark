import type { ObjectValues } from './types.ts';

export const LeaseOutcome = {
  SUCCESS: 'success',
  THROTTLED: 'throttled',
  FAILURE: 'failure',
} as const;

export type LeaseOutcome = ObjectValues<typeof LeaseOutcome>;

export const AcquireResult = {
  ACQUIRED: 'acquired',
  TIMEOUT: 'timeout',
} as const;

export type AcquireResult = ObjectValues<typeof AcquireResult>;

export const LimitChangeDirection = {
  INIT: 'init',
  INCREASE: 'increase',
  DECREASE: 'decrease',
} as const;

export type LimitChangeDirection = ObjectValues<typeof LimitChangeDirection>;
