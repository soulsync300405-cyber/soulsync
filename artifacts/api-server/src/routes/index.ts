import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import presenceRouter from "./presence";
import syncRouter from "./sync";
import voiceRouter from "./voice";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(presenceRouter);
router.use(syncRouter);
router.use(voiceRouter);

export default router;
