import { Request, Response } from "express";
import { BlockchainService } from "../services/blockchain";
import logger from "../utils/logger";

export class VerificationController {
  private blockchainService: BlockchainService;

  constructor() {
    this.blockchainService = new BlockchainService();
  }

  verifyInteraction = async (req: Request, res: Response): Promise<void> => {
    try {
      const { address } = req.params;
      const hasInteracted = await this.blockchainService.hasInteracted(
        address.toLowerCase()
      );

      // Return exactly what Galxe expects
      res.json({ result: hasInteracted ? 1 : 0 });
    } catch (error) {
      logger.error("Verification error:", error);
      // On error, return non-eligible response as per Galxe requirements
      res.json({ result: 0 });
    }
  };
}
