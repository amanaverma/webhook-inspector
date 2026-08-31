import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const bins = pgTable('bins', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  forwardUrl: text('forward_url'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Bin = typeof bins.$inferSelect;
export type NewBin = typeof bins.$inferInsert;
