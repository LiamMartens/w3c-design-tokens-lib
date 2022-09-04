import z from 'zod';

export const tokenSchema = z.object({
  $type: z.string().optional(),
  $value: z.any(),
  $description: z.string().optional(),
  $extensions: z.any().optional(),
});