import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const models = sqliteTable('models', {
  id: text('id').primaryKey(), // e.g., "black-forest-labs/FLUX.1-schnell"
  name: text('name').notNull(), // e.g., "FLUX.1 Schnell"
  type: text('type').notNull(), // "image", "llm"
  path: text('path'), // local file path if downloaded
  status: text('status').notNull().default('available'), // "available", "downloading", "ready"
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id),
  prompt: text('prompt').notNull(),
  imageUrl: text('image_url').notNull(),
  modelId: text('model_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
