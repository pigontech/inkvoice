#!/usr/bin/env bun
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { initDatabase } from "../packages/backend/src/database/connection";
import { runMigrations } from "../packages/backend/src/database/migrations";
import { seed, seedDemoData } from "../packages/backend/src/database/seed";

const dbPath = process.env.DATABASE_PATH ?? resolve(import.meta.dir, "..", "data", "invoice.db");

for (const suffix of ["", "-shm", "-wal"]) {
  const f = dbPath + suffix;
  if (existsSync(f)) unlinkSync(f);
}

initDatabase();
runMigrations();
await seed();
seedDemoData();

console.log(`Reset and reseeded ${dbPath}`);
