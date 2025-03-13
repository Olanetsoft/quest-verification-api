import { Request, Response } from "express";
import { BlockchainService } from "../services/blockchain";
import logger from "../utils/logger";

/**
 * Controller for handling verification requests
 */
export class VerificationController {
  private blockchainService: BlockchainService;

  constructor() {
    this.blockchainService = new BlockchainService();
  }

  /**
   * Verify if an address has interacted with the contract (all-time)
   */
  verifyInteraction = async (req: Request, res: Response): Promise<void> => {
    try {
      const { address } = req.params;

      if (!address || !this.isValidAddress(address)) {
        logger.warn(`Invalid address format: ${address}`);
        res.status(400).json({
          error: "Invalid Ethereum address format",
          result: 0,
        });
        return;
      }

      logger.info(`Verifying interaction for address: ${address}`);

      const hasInteracted = await this.blockchainService.hasInteracted(
        address.toLowerCase()
      );

      logger.info(
        `Verification result for ${address}: ${hasInteracted ? 1 : 0}`
      );

      // Return exactly what Galxe expects
      res.json({ result: hasInteracted ? 1 : 0 });
    } catch (error) {
      logger.error("Verification error:", error);
      // On error, return non-eligible response as per Galxe requirements
      res.json({ result: 0 });
    }
  };

  /**
   * Verify if an address has interacted with the contract within a specific time range
   */
  verifyInteractionInTimeRange = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const { address } = req.params;
      const { startDate, endDate } = req.query;

      if (!address || !this.isValidAddress(address)) {
        logger.warn(`Invalid address format: ${address}`);
        res.status(400).json({
          error: "Invalid Ethereum address format",
          result: 0,
        });
        return;
      }

      if (!startDate || !endDate) {
        logger.warn("Missing date parameters for time-range verification");
        res.status(400).json({
          error: "Both startDate and endDate query parameters are required",
          result: 0,
        });
        return;
      }

      // Parse dates from string parameters
      const startDateTime = new Date(startDate as string);
      const endDateTime = new Date(endDate as string);

      // Validate date formats
      if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
        logger.warn(
          `Invalid date format: startDate=${startDate}, endDate=${endDate}`
        );
        res.status(400).json({
          error:
            "Invalid date format. Use ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)",
          result: 0,
        });
        return;
      }

      // For end date, if no time is specified, set it to the end of the day
      if (endDate && typeof endDate === "string" && endDate.length <= 10) {
        endDateTime.setHours(23, 59, 59, 999);
      }

      // Check if start date is before end date
      if (startDateTime > endDateTime) {
        logger.warn(
          `Start date is after end date: ${startDateTime.toISOString()} > ${endDateTime.toISOString()}`
        );
        res.status(400).json({
          error: "startDate must be before endDate",
          result: 0,
        });
        return;
      }

      logger.info(
        `Verifying interaction for ${address} from ${startDateTime.toISOString()} to ${endDateTime.toISOString()}`
      );

      const hasInteracted =
        await this.blockchainService.hasInteractedInTimeRange(
          address.toLowerCase(),
          startDateTime,
          endDateTime
        );

      logger.info(
        `Time-range verification result for ${address}: ${
          hasInteracted ? 1 : 0
        }`
      );

      // Return exactly what Galxe expects
      res.json({ result: hasInteracted ? 1 : 0 });
    } catch (error) {
      logger.error("Time-range verification error:", error);
      // On error, return non-eligible response as per Galxe requirements
      res.json({ result: 0 });
    }
  };

  /**
   * Clear the cache (admin endpoint)
   */
  clearCache = async (_req: Request, res: Response): Promise<void> => {
    try {
      this.blockchainService.clearCache();
      res.json({ success: true, message: "Cache cleared successfully" });
    } catch (error) {
      logger.error("Error clearing cache:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to clear cache" });
    }
  };

  /**
   * Helper method to validate Ethereum address format
   */
  private isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
}
