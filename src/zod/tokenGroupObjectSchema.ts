import z from 'zod';

export const tokenGroupObjectSchema = z.object({
  $type: z.string().optional(),
  $description: z.string().optional(),
  $extensions: z.any().optional(),
})