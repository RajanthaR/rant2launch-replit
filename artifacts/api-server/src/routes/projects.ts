import { Router, type IRouter } from "express";
import { registerCreateProjectRoutes } from "./projects/create";
import { registerAssetCardRoutes } from "./projects/asset-cards";
import { registerSectionRegenerationRoutes } from "./projects/section-regeneration";
import { registerLandingFaqRoutes } from "./projects/landing-faq";
import { registerStoryboardImageRoutes } from "./projects/storyboard-images";
import { registerShareLinkRoutes } from "./projects/share-links";
import { registerProjectLifecycleRoutes } from "./projects/project-lifecycle";

const router: IRouter = Router();

registerCreateProjectRoutes(router);
registerAssetCardRoutes(router);
registerSectionRegenerationRoutes(router);
registerLandingFaqRoutes(router);
registerStoryboardImageRoutes(router);
registerShareLinkRoutes(router);
registerProjectLifecycleRoutes(router);

export default router;
