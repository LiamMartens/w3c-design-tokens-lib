import z from 'zod';
import { ITokenGroup, TTokenLibraryMap } from '../types';
import { tokenGroupObjectSchema } from './tokenGroupObjectSchema';
import { tokenSchema } from './tokenSchema';

type AnyTokenGroup = ITokenGroup<TTokenLibraryMap<any, any>, Record<string, unknown>>
export const tokenGroupChildrenSchema: z.ZodType<AnyTokenGroup> = z.lazy(() => (
  z.record(tokenSchema.or(tokenGroupChildrenSchema).or(tokenGroupObjectSchema))
));
