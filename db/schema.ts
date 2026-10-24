import { pgTable, serial, text, timestamp, doublePrecision, index } from 'drizzle-orm/pg-core';

export const records = pgTable('assessments', {
  id: serial().primaryKey(),
  userId: text('user_id').notNull(),
  created: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  child: text().notNull().default(''),
  age_months: doublePrecision().notNull(),
  weight_kg: doublePrecision().notNull(),
  height_cm: doublePrecision().notNull(),
  muac_cm: doublePrecision().notNull(),
  bmi: doublePrecision().notNull(),
  status: text().notNull(),
  confidence: doublePrecision().notNull(),
}, table => [index('assessments_user_id_idx').on(table.userId)]);
