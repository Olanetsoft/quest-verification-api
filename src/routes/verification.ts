import { Router } from "express";
import { VerificationController } from "../controllers/verification";

const router = Router();
const verificationController = new VerificationController();

// Simple route without middleware
router.get("/verify/:address", verificationController.verifyInteraction);

// Handle OPTIONS requests for Galxe preflight
router.options("/verify/:address", (_, res) => {
  res.status(200).end();
});

export default router;
