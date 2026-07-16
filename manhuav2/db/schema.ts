import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const parentAccounts = sqliteTable("parent_accounts", {
  id: text("id").primaryKey(),
  phoneHash: text("phone_hash").unique(),
  downloadAllowed: integer("download_allowed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const childProfiles = sqliteTable("child_profiles", {
  id: text("id").primaryKey(),
  parentId: text("parent_id").notNull().references(() => parentAccounts.id, { onDelete: "cascade" }),
  nickname: text("nickname").notNull(),
  avatarCode: text("avatar_code").notNull().default("sprout"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  childId: text("child_id").notNull().references(() => childProfiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  referenceImageKey: text("reference_image_key"),
  appearanceJson: text("appearance_json").notNull(),
  style: text("style").notNull(),
  status: text("status", { enum: ["active", "deleted"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const artworks = sqliteTable("artworks", {
  id: text("id").primaryKey(),
  childId: text("child_id").notNull().references(() => childProfiles.id, { onDelete: "cascade" }),
  characterId: text("character_id").notNull().references(() => characters.id),
  title: text("title").notNull().default("我的漫画场景"),
  currentVersionId: text("current_version_id"),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["active", "deleted"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const artworkVersions = sqliteTable("artwork_versions", {
  id: text("id").primaryKey(),
  artworkId: text("artwork_id").notNull().references(() => artworks.id, { onDelete: "cascade" }),
  parentVersionId: text("parent_version_id"),
  imageKey: text("image_key").notNull(),
  promptSnapshotJson: text("prompt_snapshot_json").notNull(),
  lockedFieldsJson: text("locked_fields_json").notNull(),
  changedFieldsJson: text("changed_fields_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const generationJobs = sqliteTable("generation_jobs", {
  id: text("id").primaryKey(),
  childId: text("child_id").notNull().references(() => childProfiles.id, { onDelete: "cascade" }),
  artworkId: text("artwork_id").references(() => artworks.id),
  status: text("status", { enum: ["queued", "generating", "evaluating", "completed", "failed", "blocked"] }).notNull().default("queued"),
  referenceVersionId: text("reference_version_id"),
  selectedCandidate: integer("selected_candidate"),
  evaluatorResultJson: text("evaluator_result_json"),
  errorCode: text("error_code"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
