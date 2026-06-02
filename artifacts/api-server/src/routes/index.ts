import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import presenceRouter from "./presence";
import syncRouter from "./sync";
import voiceRouter from "./voice";
import videoChatRouter from "./video-chat";
import faceAnalyzeRouter from "./face-analyze";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(presenceRouter);
router.use(syncRouter);
router.use(voiceRouter);
router.use(videoChatRouter);
router.use(faceAnalyzeRouter);

export default router;
