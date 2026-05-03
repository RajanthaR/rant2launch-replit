import app from "./app";
import { logger } from "./lib/logger";
import { seedDemoProject } from "./lib/demo-seed";
import { startCleanupScheduler } from "./lib/cleanup-runs";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Fire-and-forget: ensure the gold-standard demo project exists at slug
  // `demo` so /projects/demo always loads instantly, even if live OpenAI
  // generation is down. Failures are logged and don't crash the server.
  // Pass DEMO_SEED_FORCE=1 to refresh the seed from the manifest.
  const force = process.env["DEMO_SEED_FORCE"] === "1";
  seedDemoProject({ force })
    .then((result) => {
      logger.info({ result }, "Demo project seed");
    })
    .catch((seedErr) => {
      logger.error({ err: seedErr }, "Demo project seed failed");
    });

  // Background pruning of old generation_runs so the audit table doesn't
  // grow unbounded. Configurable via CLEANUP_RETENTION_DAYS,
  // CLEANUP_INTERVAL_MS, and CLEANUP_ENABLED env vars.
  startCleanupScheduler();
});
