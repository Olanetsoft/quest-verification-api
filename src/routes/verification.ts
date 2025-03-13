import { Router } from "express";
import { VerificationController } from "../controllers/verification";

const router = Router();
const verificationController = new VerificationController();

/**
 * Verification endpoint
 * GET /api/verify/:address?contract=contract_id
 * Optional query param: ?campaign=campaign_id
 *
 * Required query parameters:
 * - contract: The contract identifier
 *
 * Optional query parameters:
 * - campaign: Campaign identifier for specific campaign verification
 */
router.get("/verify/:address", verificationController.verifyInteraction);

/**
 * Time-range verification endpoint
 * GET /api/verify-in-range/:address?contract=contract_id&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Required query parameters:
 * - contract: The contract identifier
 * - startDate, endDate: Date range (if campaign not specified)
 *
 * Optional query parameters:
 * - campaign: Campaign identifier (if provided, startDate and endDate are not required)
 */
router.get(
  "/verify-in-range/:address",
  verificationController.verifyInteractionInTimeRange
);

/**
 * List all contracts and campaigns
 * GET /api/contracts
 */
router.get("/contracts", verificationController.listContractsAndCampaigns);

/**
 * Get campaign details
 * GET /api/contracts/:contractId/campaigns/:campaignId
 */
router.get(
  "/contracts/:contractId/campaigns/:campaignId",
  verificationController.getCampaignDetails
);

/**
 * Reload configuration
 * GET /api/reload-config
 */
router.get("/reload-config", verificationController.reloadConfig);

/**
 * Admin endpoint to clear cache
 * GET /api/clear-cache
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

router.options("/contracts", (_, res) => {
  res.status(200).end();
});

router.options("/contracts/:contractId/campaigns/:campaignId", (_, res) => {
  res.status(200).end();
});

export default router;
