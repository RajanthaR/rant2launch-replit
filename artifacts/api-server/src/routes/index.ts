import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import jobsRouter from "./jobs";
import storageRouter from "./storage";
import audioRouter from "./audio";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(jobsRouter);
router.use(storageRouter);
router.use(audioRouter);

export default router;
