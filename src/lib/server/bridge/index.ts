import { notImplemented } from '#lib/server/not-implemented.ts';
import type { HandleToolCall } from './types.ts';

export type * from './types.ts';

export const handleToolCall: HandleToolCall = async () => notImplemented('bridge.handleToolCall');
