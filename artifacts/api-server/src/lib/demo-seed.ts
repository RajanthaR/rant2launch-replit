import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  db,
  projectsTable,
  sourceInputsTable,
  generationRunsTable,
  assetCardsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";
import { setObjectAclPolicy } from "./objectAcl";
import { logger } from "./logger";

// Fixed slug for the gold-standard demo project. Visiting /projects/demo
// always renders this seeded launch even if live OpenAI generation is down.
export const DEMO_PROJECT_SLUG = "demo";

interface SeedManifest {
  project: {
    slug: string;
    name: string;
    description: string | null;
  };
  sourceInput: {
    kind: string;
    title: string | null;
    rawText: string;
    metadata: Record<string, unknown> | null;
  };
  generationRun: {
    status: string;
    model: string;
    promptVersion: string;
  };
  assetCards: Array<{
    kind: string;
    title: string | null;
    content: unknown;
    position: number;
  }>;
  images: Array<{
    original: string;
    seedFile: string;
    newUrl: string;
    kind: "storyboard" | "carousel";
    index: number;
  }>;
}

export type SeedResult =
  | { status: "exists" }
  | { status: "created" | "refreshed" }
  | { status: "skipped"; reason: string };

function resolveSeedDir(): string | null {
  // build.mjs copies src/seeds → dist/seeds, so when this module is bundled
  // into dist/index.mjs the seeds live next to it. In dev (also runs the
  // built bundle via `pnpm run dev`) this is the same path. We try a few
  // candidates so the seeder also works if the file layout shifts.
  const candidates = [
    path.resolve(__dirname, "seeds/demo"),
    path.resolve(__dirname, "../seeds/demo"),
    path.resolve(__dirname, "../../src/seeds/demo"),
    path.resolve(process.cwd(), "src/seeds/demo"),
    path.resolve(
      process.cwd(),
      "artifacts/api-server/src/seeds/demo",
    ),
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "manifest.json"))) return c;
  }
  return null;
}

function parseObjectPath(fullPath: string): {
  bucketName: string;
  objectName: string;
} {
  const normalized = fullPath.startsWith("/") ? fullPath : `/${fullPath}`;
  const parts = normalized.split("/");
  if (parts.length < 3) throw new Error(`Invalid object path: ${fullPath}`);
  return { bucketName: parts[1]!, objectName: parts.slice(2).join("/") };
}

async function uploadSeedImages(
  seedDir: string,
  manifest: SeedManifest,
): Promise<void> {
  const service = new ObjectStorageService();
  let privateDir: string;
  try {
    privateDir = service.getPrivateObjectDir();
  } catch (err) {
    logger.warn(
      { err },
      "Object storage not configured; demo seed will insert text-only cards",
    );
    return;
  }

  const dirNoSlash = privateDir.endsWith("/")
    ? privateDir.slice(0, -1)
    : privateDir;

  for (const img of manifest.images) {
    const seedFile = path.join(seedDir, "images", img.seedFile);
    if (!existsSync(seedFile)) {
      logger.warn({ seedFile }, "Demo seed image missing on disk; skipping");
      continue;
    }
    const bytes = readFileSync(seedFile);
    const entityId = img.newUrl.replace(/^\/objects\//, "");
    const fullPath = `${dirNoSlash}/${entityId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(bytes, {
      contentType: "image/png",
      resumable: false,
      metadata: { contentType: "image/png" },
    });
    await setObjectAclPolicy(file, {
      owner: `project:${DEMO_PROJECT_SLUG}`,
      visibility: "public",
    });
  }
}

/**
 * Idempotently insert (or refresh) the gold-standard demo project at slug
 * `demo`. Safe to call on every server boot: when the project already
 * exists and `force` is false it returns immediately.
 *
 * `force: true` deletes the existing demo project (cascade clears its
 * source inputs, runs, and asset cards) and re-inserts from the manifest.
 * Use it to bake new copy/visuals into the seed.
 */
export async function seedDemoProject(
  opts: { force?: boolean } = {},
): Promise<SeedResult> {
  const existing = (
    await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.slug, DEMO_PROJECT_SLUG))
      .limit(1)
  )[0];

  if (existing && !opts.force) {
    return { status: "exists" };
  }

  const seedDir = resolveSeedDir();
  if (!seedDir) {
    return { status: "skipped", reason: "manifest.json not found" };
  }

  const manifest = JSON.parse(
    readFileSync(path.join(seedDir, "manifest.json"), "utf8"),
  ) as SeedManifest;

  // Re-upload images first; if storage is unavailable we still seed the
  // text cards so the page renders (image-less storyboard frames + carousel
  // slides degrade gracefully in the workspace).
  try {
    await uploadSeedImages(seedDir, manifest);
  } catch (err) {
    logger.warn(
      { err },
      "Demo seed image upload failed; continuing with DB rows",
    );
  }

  await db.transaction(async (tx) => {
    if (existing) {
      // Cascade deletes source_inputs / generation_runs / asset_cards.
      await tx.delete(projectsTable).where(eq(projectsTable.id, existing.id));
    }
    const [project] = await tx
      .insert(projectsTable)
      .values({
        name: manifest.project.name,
        slug: manifest.project.slug,
        description: manifest.project.description,
      })
      .returning();
    const [sourceInput] = await tx
      .insert(sourceInputsTable)
      .values({
        projectId: project!.id,
        kind: manifest.sourceInput.kind,
        title: manifest.sourceInput.title,
        rawText: manifest.sourceInput.rawText,
        metadata: manifest.sourceInput.metadata,
      })
      .returning();
    const now = new Date();
    const [run] = await tx
      .insert(generationRunsTable)
      .values({
        projectId: project!.id,
        sourceInputId: sourceInput!.id,
        status: manifest.generationRun.status,
        model: manifest.generationRun.model,
        promptVersion: manifest.generationRun.promptVersion,
        startedAt: now,
        completedAt: now,
      })
      .returning();
    await tx.insert(assetCardsTable).values(
      manifest.assetCards.map((c) => ({
        projectId: project!.id,
        sourceInputId: sourceInput!.id,
        generationRunId: run!.id,
        kind: c.kind,
        title: c.title,
        content: c.content as Record<string, unknown>,
        position: c.position,
      })),
    );
  });

  return { status: existing ? "refreshed" : "created" };
}
