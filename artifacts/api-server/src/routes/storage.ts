import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "node:stream";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * GET /storage/objects/*
 *
 * Serve objects from PRIVATE_OBJECT_DIR. Access is gated by the ACL policy
 * stored in the object's custom metadata. Default-deny: any object that
 * was uploaded without an ACL policy returns 403.
 *
 * The launch pipeline writes generated visuals (storyboard frames and
 * carousel slides) with { visibility: "public" } so they render inline in
 * the workspace. Any other private object is unreachable through this
 * endpoint without an explicit policy that allows the caller.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    // Enforce ACL before streaming. canAccessObjectEntity returns false when
    // the object has no ACL policy, so the namespace is closed by default.
    // We do not have authenticated users in this app, so userId is omitted —
    // only objects with visibility: "public" READ access are served.
    const canAccess = await objectStorageService.canAccessObjectEntity({
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (!canAccess) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
