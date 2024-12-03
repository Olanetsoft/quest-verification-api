import { ethers } from "ethers";
import config from "../config/env";
import logger from "../utils/logger";

const ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function minter() view returns (address)",
  "function mint(address account, uint256 amount)",
  "function setMinter(address _minter)",
];

const BLOCK_RANGE = 5000; // Reduced block range
const MAX_RETRIES = 3;
const BATCH_DELAY = 200; // 200ms delay between batches

export class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.contract = new ethers.Contract(
      config.aerodromeAddress,
      ABI,
      this.provider
    );
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async queryWithRetry(
    fromBlock: number,
    toBlock: number,
    filter: any,
    retryCount = 0
  ): Promise<ethers.Log[]> {
    try {
      logger.debug(`Querying blocks ${fromBlock} to ${toBlock}`);
      const logs = await this.contract.queryFilter(filter, fromBlock, toBlock);
      return logs;
    } catch (error: any) {
      if (retryCount < MAX_RETRIES) {
        await this.delay(BATCH_DELAY * (retryCount + 1));
        return this.queryWithRetry(fromBlock, toBlock, filter, retryCount + 1);
      }
      logger.error(`Failed after ${MAX_RETRIES} retries:`, error);
      return [];
    }
  }

  async hasInteracted(address: string): Promise<boolean> {
    try {
      const normalizedAddress = address.toLowerCase();
      logger.info(`Checking interactions for address: ${normalizedAddress}`);

      // Start with recent blocks for faster response
      const currentBlock = await this.provider.getBlockNumber();
      const startBlock = Math.max(currentBlock - 50000, 7787595); // Last 50k blocks or contract deployment

      for (
        let fromBlock = currentBlock;
        fromBlock > startBlock;
        fromBlock -= BLOCK_RANGE
      ) {
        const toBlock = fromBlock;
        const fromBlockBatch = Math.max(fromBlock - BLOCK_RANGE, startBlock);

        // Check transfers first
        const transferFilter =
          this.contract.filters.Transfer(normalizedAddress);
        const transferToFilter = this.contract.filters.Transfer(
          null,
          normalizedAddress
        );

        await this.delay(BATCH_DELAY); // Rate limiting delay
        const [transferLogs, transferToLogs] = await Promise.all([
          this.queryWithRetry(fromBlockBatch, toBlock, transferFilter),
          this.queryWithRetry(fromBlockBatch, toBlock, transferToFilter),
        ]);

        if (transferLogs.length > 0 || transferToLogs.length > 0) {
          logger.info("Found transfer interaction");
          return true;
        }

        // Only check approvals if no transfers found
        const approvalFilter =
          this.contract.filters.Approval(normalizedAddress);
        const approvalSpenderFilter = this.contract.filters.Approval(
          null,
          normalizedAddress
        );

        await this.delay(BATCH_DELAY); // Rate limiting delay
        const [approvalLogs, approvalSpenderLogs] = await Promise.all([
          this.queryWithRetry(fromBlockBatch, toBlock, approvalFilter),
          this.queryWithRetry(fromBlockBatch, toBlock, approvalSpenderFilter),
        ]);

        if (approvalLogs.length > 0 || approvalSpenderLogs.length > 0) {
          logger.info("Found approval interaction");
          return true;
        }
      }

      // Finally check minter role
      const isMinter = await this.checkMinterRole(normalizedAddress);
      if (isMinter) {
        logger.info("Address is minter");
        return true;
      }

      logger.info("No interactions found");
      return false;
    } catch (error) {
      logger.error("Error checking interactions:", error);
      throw new Error("Failed to verify contract interactions");
    }
  }

  private async checkMinterRole(address: string): Promise<boolean> {
    try {
      const currentMinter = await this.contract.minter();
      return currentMinter.toLowerCase() === address.toLowerCase();
    } catch (error) {
      logger.debug("Error checking minter role:", error);
      return false;
    }
  }
}
