import { unlinkSync } from "node:fs";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed, seedDemoData } from "../database/seed";
import { getEnv } from "../utils/env";
import { logger } from "../utils/logger";
import { processAllDue } from "./recurring.service";
import { processAllReminders } from "./reminder.service";

let intervalId: ReturnType<typeof setInterval> | null = null;
let demoIntervalId: ReturnType<typeof setInterval> | null = null;

export function startScheduler(intervalMs = 60 * 60 * 1000): void {
  if (intervalId) return;

  // Run immediately on startup
  runScheduledTasks();

  // Then run periodically
  intervalId = setInterval(runScheduledTasks, intervalMs);
  logger.info({ intervalSec: intervalMs / 1000 }, "Scheduler started");

  // Start demo reset job if demo mode is enabled
  const env = getEnv();
  if (env.DEMO_MODE && !demoIntervalId) {
    demoIntervalId = setInterval(resetDemoData, env.DEMO_RESET_INTERVAL);
    logger.info({ intervalSec: env.DEMO_RESET_INTERVAL / 1000 }, "Demo reset scheduler started");
  }
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (demoIntervalId) {
    clearInterval(demoIntervalId);
    demoIntervalId = null;
  }
}

// Extension point: deleting and re-seeding env.DATABASE_PATH only makes sense
// when that file is the live database. A deployment where it isn't (e.g. one
// database per workspace) disables demo resets entirely.
let demoResetEnabled = true;

export function setDemoResetEnabled(enabled: boolean): void {
  demoResetEnabled = enabled;
}

export async function resetDemoData(): Promise<void> {
  const env = getEnv();
  if (!demoResetEnabled) {
    throw new Error("resetDemoData is disabled in this deployment");
  }
  try {
    // Close DB, delete file, reinitialize from scratch
    closeDatabase();
    try {
      unlinkSync(env.DATABASE_PATH);
    } catch {
      // File may not exist on first run
    }
    initDatabase();
    runMigrations();
    await seed();
    seedDemoData();
    logger.info("Demo database reset complete.");
  } catch (err) {
    logger.error({ err }, "Demo reset error");
  }
}

async function runScheduledTasks(): Promise<void> {
  try {
    const recurring = processAllDue();
    if (recurring.generated > 0 || recurring.errors > 0) {
      logger.info(
        { generated: recurring.generated, errors: recurring.errors },
        "Scheduler: recurring invoices generated",
      );
    }
  } catch (err) {
    logger.error({ err }, "Scheduler recurring error");
  }

  try {
    const reminders = await processAllReminders();
    if (reminders.sent > 0 || reminders.errors > 0) {
      logger.info({ sent: reminders.sent, errors: reminders.errors }, "Scheduler: reminders sent");
    }
  } catch (err) {
    logger.error({ err }, "Scheduler reminder error");
  }
}
