import { renderModule, renderToolMember, signatureHash as hash } from './declarations.ts';
import { toCamelCase as camel, toNamespace as namespace } from './names.ts';
import type { TypeGenerator } from './types.ts';

export type { SignatureInput, ToolTypeInput, TypeGenerator } from './types.ts';
export { functionNames, isIdentifier, uniqueName } from './names.ts';
export { canonicalJson, NO_OUTPUT_SCHEMA_NOTE, UNVERIFIED_WARNING } from './declarations.ts';
export { sanitizeComment, schemaToType } from './schema.ts';

export const toolDeclaration: TypeGenerator['toolDeclaration'] = async (tool) =>
	renderToolMember(tool);
export const moduleDeclaration: TypeGenerator['moduleDeclaration'] = async (tools) =>
	renderModule(tools);
export const toCamelCase: TypeGenerator['toCamelCase'] = camel;
export const toNamespace: TypeGenerator['toNamespace'] = namespace;
export const signatureHash: TypeGenerator['signatureHash'] = hash;
