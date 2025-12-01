import type { CallResultEnum } from './constants.ts';

export type ObjectValues<T> = T[keyof T];

export type CallResultEvent = {
	id: string;
	callResult: CallResultEnum;
	timestamp: number;
};
