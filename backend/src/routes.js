import express from "express";
import { initUpload, uploadChunk, finalizeUpload, resetUpload } from "./controllers/uploadController.js";

const router = express.Router();

router.post("/init", initUpload);
router.post("/chunk", uploadChunk);
router.post("/finalize", finalizeUpload);
router.post("/reset", resetUpload);  // <-- new

export default router;
