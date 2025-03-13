import { Router } from "express";
import { VerificationController } from "../controllers/verification";

const router = Router();
const verificationController = new VerificationController();

/**
 * Original verification endpoint (kept for backward compatibility)
 * GET /api/verify/:address
 */
router.get("/verify/:address", verificationController.verifyInteraction);

/**
 * New endpoint for time-range verification
 * GET /api/verify-in-range/:address?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
router.get(
  "/verify-in-range/:address",
  verificationController.verifyInteractionInTimeRange
);

/**
 * Admin endpoint to clear cache
 * POST /api/clear-cache
 */
router.get("/clear-cache", verificationController.clearCache);

/**
 * Handle OPTIONS requests for CORS preflight
 */
router.options("/verify/:address", (_, res) => {
  res.status(200).end();
});

router.options("/verify-in-range/:address", (_, res) => {
  res.status(200).end();
});

export default router;
