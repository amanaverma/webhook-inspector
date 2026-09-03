import { bins, type Db } from '@wi/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateSlug } from '../slug.js';

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const createBinBody = z.object({
  name: z.string().trim().min(1).max(80).default('Untitled bin'),
  forwardUrl: z
    .string()
    .refine(isHttpUrl, { message: 'forwardUrl must be an http or https URL' })
    .nullish(),
});

export function registerBinRoutes(app: FastifyInstance, db: Db): void {
  app.post('/api/bins', async (request, reply) => {
    const parsed = createBinBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_body',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const [bin] = await db
      .insert(bins)
      .values({
        slug: generateSlug(),
        name: parsed.data.name,
        forwardUrl: parsed.data.forwardUrl ?? null,
      })
      .returning();

    return reply.code(201).send(bin);
  });
}
