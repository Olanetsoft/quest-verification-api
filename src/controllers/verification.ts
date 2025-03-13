import { Request, Response } from "express";
import { BlockchainService } from "../services/blockchain";
import configLoader from "../config/config-loader";
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
   *
   * @param req Express request
   * @param res Express response
   * @returns Promise<void>
   */
  verifyInteraction = async (req: Request, res: Response): Promise<void> => {
    const startTime = performance.now();
    try {
      const { address } = req.params;
      const { contract, campaign } = req.query;

      // Validate required parameters
      if (!address) {
        res.status(400).json({
          error: "Address is required",
          result: 0,
        });
        return;
      }

      if (!contract) {
        res.status(400).json({
          error:
            "Contract ID is required. Please specify the 'contract' query parameter.",
          result: 0,
        });
        return;
      }

      const contractId = String(contract);
      const campaignId = campaign ? String(campaign) : undefined;

      if (!this.isValidAddress(address)) {
        logger.warn(`Invalid address format: ${address}`);
        res.status(400).json({
          error: "Invalid Ethereum address format",
          result: 0,
        });
        return;
      }

      logger.info(
        `Verifying interaction for address: ${address} on contract: ${contractId}, campaign: ${
          campaignId || "none"
        }`
      );

      const hasInteracted = await this.blockchainService.hasInteracted(
        address.toLowerCase(),
        contractId,
        campaignId
      );

      const endTime = performance.now();
      const processingTime = ((endTime - startTime) / 1000).toFixed(2);

      logger.info(
        `Verification result for ${address} on ${contractId}, campaign: ${
          campaignId || "none"
        }: ${hasInteracted ? 1 : 0}. Processing time: ${processingTime} seconds`
      );

      // Return exactly what Galxe expects (without processing time in response)
      res.json({ result: hasInteracted ? 1 : 0 });
    } catch (error: any) {
      const endTime = performance.now();
      const processingTime = ((endTime - startTime) / 1000).toFixed(2);

      logger.error(`Verification error (${processingTime} seconds):`, error);
      // On error, return non-eligible response as per Galxe requirements
      res.status(500).json({ result: 0, error: error.message });
    }
  };

  /**
   * Verify if an address has interacted with the contract within a specific time range
   *
   * @param req Express request
   * @param res Express response
   * @returns Promise<void>
   */
  verifyInteractionInTimeRange = async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const startTime = performance.now();
    try {
      const { address } = req.params;
      const { startDate, endDate, contract, campaign } = req.query;

      // Validate required parameters
      if (!address) {
        res.status(400).json({
          error: "Address is required",
          result: 0,
        });
        return;
      }

      if (!contract) {
        res.status(400).json({
          error:
            "Contract ID is required. Please specify the 'contract' query parameter.",
          result: 0,
        });
        return;
      }

      const contractId = String(contract);
      const campaignId = campaign ? String(campaign) : undefined;

      if (!this.isValidAddress(address)) {
        logger.warn(`Invalid address format: ${address}`);
        res.status(400).json({
          error: "Invalid Ethereum address format",
          result: 0,
        });
        return;
      }

      // If a campaign is specified, use its date range instead of the query parameters
      if (campaignId) {
        try {
          const campaignConfig = configLoader.getCampaignConfig(
            contractId,
            campaignId
          );

          if (!campaignConfig) {
            res.status(400).json({
              error: `Campaign not found: ${campaignId}`,
              result: 0,
            });
            return;
          }

          logger.info(
            `Using campaign dates for ${campaignId}: ${campaignConfig.startDate} to ${campaignConfig.endDate}`
          );

          const campaignStartDate = new Date(campaignConfig.startDate);
          const campaignEndDate = new Date(campaignConfig.endDate);

          const hasInteracted =
            await this.blockchainService.hasInteractedInTimeRange(
              address.toLowerCase(),
              campaignStartDate,
              campaignEndDate,
              contractId
            );

          const endTime = performance.now();
          const processingTime = ((endTime - startTime) / 1000).toFixed(2);

          logger.info(
            `Campaign verification result for ${address} on ${contractId}, campaign: ${campaignId}: ${
              hasInteracted ? 1 : 0
            }. Processing time: ${processingTime} seconds`
          );

          // Return exactly what Galxe expects (without processing time in response)
          res.json({ result: hasInteracted ? 1 : 0 });
          return;
        } catch (error: any) {
          const endTime = performance.now();
          const processingTime = ((endTime - startTime) / 1000).toFixed(2);

          logger.error(
            `Campaign verification error (${processingTime} seconds):`,
            error
          );
          res.status(400).json({
            error: `Invalid campaign configuration: ${error.message}`,
            result: 0,
          });
          return;
        }
      }

      // If no campaign specified, use the date range from the query parameters
      if (!startDate || !endDate) {
        logger.warn("Missing date parameters for time-range verification");
        res.status(400).json({
          error:
            "Both startDate and endDate query parameters are required when no campaign is specified",
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
        `Verifying interaction for ${address} on ${contractId} from ${startDateTime.toISOString()} to ${endDateTime.toISOString()}`
      );

      const hasInteracted =
        await this.blockchainService.hasInteractedInTimeRange(
          address.toLowerCase(),
          startDateTime,
          endDateTime,
          contractId
        );

      const endTime = performance.now();
      const processingTime = ((endTime - startTime) / 1000).toFixed(2);

      logger.info(
        `Time-range verification result for ${address} on ${contractId}: ${
          hasInteracted ? 1 : 0
        }. Processing time: ${processingTime} seconds`
      );

      // Return exactly what Galxe expects (without processing time in response)
      res.json({ result: hasInteracted ? 1 : 0 });
    } catch (error: any) {
      const endTime = performance.now();
      const processingTime = ((endTime - startTime) / 1000).toFixed(2);

      logger.error(
        `Time-range verification error (${processingTime} seconds):`,
        error
      );
      // On error, return non-eligible response as per Galxe requirements
      res.status(500).json({ result: 0, error: error.message });
    }
  };

  /**
   * List available contracts and campaigns
   *
   * @param req Express request
   * @param res Express response
   * @returns Promise<void>
   */
  listContractsAndCampaigns = async (
    _req: Request,
    res: Response
  ): Promise<void> => {
    try {
      const contracts = this.blockchainService.getAvailableContracts();

      // Build response with contract and campaign details
      const response: Record<string, any> = {};

      for (const contractId of contracts) {
        try {
          const contractConfig = configLoader.getContractConfig(contractId);
          const campaignsConfig = configLoader.getContractCampaigns(contractId);

          response[contractId] = {
            name: contractConfig.name,
            address: contractConfig.address,
            chainId: contractConfig.chainId,
            campaigns: campaignsConfig,
          };
        } catch (error) {
          logger.error(
            `Error getting details for contract ${contractId}:`,
            error
          );
          // Skip this contract if there's an error
        }
      }

      res.json({
        success: true,
        contracts: response,
      });
    } catch (error: any) {
      logger.error("Error listing contracts and campaigns:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  };

  /**
   * Reload configuration from file
   *
   * @param req Express request
   * @param res Express response
   * @returns Promise<void>
   */
  reloadConfig = async (_req: Request, res: Response): Promise<void> => {
    try {
      configLoader.reloadConfig();
      this.blockchainService.reloadContractConfigurations();

      res.json({
        success: true,
        message: "Configuration reloaded successfully",
      });
    } catch (error: any) {
      logger.error("Error reloading configuration:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  };

  /**
   * Get campaign details
   *
   * @param req Express request
   * @param res Express response
   * @returns Promise<void>
   */
  getCampaignDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const { contractId, campaignId } = req.params;

      if (!contractId || !campaignId) {
        res.status(400).json({
          success: false,
          error: "Both contract ID and campaign ID are required",
        });
        return;
      }

      try {
        const campaignConfig = configLoader.getCampaignConfig(
          contractId,
          campaignId
        );
        if (!campaignConfig) {
          res.status(404).json({
            success: false,
            error: `Campaign not found: ${campaignId}`,
          });
          return;
        }

        res.json({
          success: true,
          campaign: campaignConfig,
        });
      } catch (error: any) {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      }
    } catch (error: any) {
      logger.error("Error getting campaign details:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  };

  /**
   * Clear the cache
   *
   * @param req Express request
   * @param res Express response
   * @returns Promise<void>
   */
  clearCache = async (_req: Request, res: Response): Promise<void> => {
    try {
      this.blockchainService.clearCache();
      res.json({ success: true, message: "Cache cleared successfully" });
    } catch (error: any) {
      logger.error("Error clearing cache:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  /**
   * Helper method to validate Ethereum address format
   *
   * @param address Ethereum address to validate
   * @returns True if address is valid
   */
  private isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
}
