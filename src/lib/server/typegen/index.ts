import { notImplemented } from '#lib/server/not-implemented.ts';
import type { TypeGenerator } from './types.ts';

export type { ToolTypeInput, TypeGenerator } from './types.ts';

export const toolDeclaration: TypeGenerator['toolDeclaration'] = async () =>
	notImplemented('typegen.toolDeclaration');
export const moduleDeclaration: TypeGenerator['moduleDeclaration'] = async () =>
	notImplemented('typegen.moduleDeclaration');
export const toCamelCase: TypeGenerator['toCamelCase'] = () =>
	notImplemented('typegen.toCamelCase');
