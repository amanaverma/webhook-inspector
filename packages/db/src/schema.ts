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

/**
 * `pending` is due for an attempt, `sending` is claimed by a worker, `sent`
 * succeeded, `failed` will be retried, and `dead` will not be retried again.
 */
export type DeliveryState = 'pending' | 'sending' | 'sent' | 'failed' | 'dead';

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

export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    targetUrl: text('target_url').notNull(),
    attempt: integer('attempt').notNull(),
    state: text('state').$type<DeliveryState>().notNull().default('pending'),
    responseStatus: integer('response_status'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    dedupeKey: text('dedupe_key').notNull().unique(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('deliveries_due_idx').on(table.state, table.nextAttemptAt),
    index('deliveries_request_idx').on(table.requestId, table.attempt),
  ],
);

export type Bin = typeof bins.$inferSelect;
export type NewBin = typeof bins.$inferInsert;
export type Request = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;
export type Delivery = typeof deliveries.$inferSelect;
export type NewDelivery = typeof deliveries.$inferInsert;
