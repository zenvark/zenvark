import type { CallResult } from './constants.ts';

export type ObjectValues<T> = T[keyof T];

export type CallResultEvent = {
	id: string;
	callResult: CallResult;
	timestamp: number;
};
