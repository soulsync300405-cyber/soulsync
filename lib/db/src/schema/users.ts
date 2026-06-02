import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("ss_users", {
  id:             serial("id").primaryKey(),
  clientId:       text("client_id").notNull().unique(),
  name:           text("name").notNull().default(""),
  tags:           text("tags").array().notNull().default([]),
  level:          integer("level").notNull().default(1),
  xp:             integer("xp").notNull().default(0),
  streak:         integer("streak").notNull().default(0),
  sessions:       integer("sessions").notNull().default(0),
  adaptiveMemory: text("adaptive_memory").notNull().default(""),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
