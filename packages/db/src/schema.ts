import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const bins = pgTable('bins', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  forwardUrl: text('forward_url'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const requests = pgTable(
  'requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    binId: uuid('bin_id')
      .notNull()
      .references(() => bins.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    query: jsonb('query').$type<Record<string, string | string[]>>().notNull().default({}),
    headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
    body: bytea('body').notNull(),
    bodySize: integer('body_size').notNull(),
    truncated: boolean('truncated').notNull().default(false),
    contentType: text('content_type'),
    sourceIp: inet('source_ip'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('requests_bin_received_idx').on(table.binId, sql`received_at desc`, sql`id desc`)],
);

export type Bin = typeof bins.$inferSelect;
export type NewBin = typeof bins.$inferInsert;
export type Request = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;
