import { ethers } from "ethers";
import config from "../config/env";
import logger from "../utils/logger";
import NodeCache from "node-cache";
import { performance } from "perf_hooks";

/**
 * Core ABI elements needed for interactions with the token contract
 */
const ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "function mint(address account, uint256 amount) external returns (bool)",
  "function setMinter(address _minter)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
  "function minter() view returns (address)",
];

// Configuration constants
const BLOCK_RANGE = 1000; // Number of blocks to query at once
const RECENT_BLOCKS = 1800; // Define what "recent" means in terms of blocks
const CACHE_TTL = 3600; // Cache TTL in seconds (1 hour)
const MAX_RETRIES = 2; // Number of retries for failed queries

/**
 * Service for interacting with blockchain contracts and verifying address interactions
 */
export class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private cache: NodeCache;
  private queryCount: number = 0;
  private cacheHits: number = 0;
  private static isInitialized = false;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.contract = new ethers.Contract(
      config.aerodromeAddress,
      ABI,
      this.provider
    );
    this.cache = new NodeCache({
      stdTTL: CACHE_TTL,
      checkperiod: 600,
      useClones: false,
    });

    // Log performance stats periodically
    setInterval(() => this.logStats(), 10800000); // 3 hours

    if (!BlockchainService.isInitialized) {
      this.clearCache();
      BlockchainService.isInitialized = true;
    }
  }

  /**
   * Log performance statistics
   */
  private logStats() {
    const hitRate = (this.cacheHits / this.queryCount) * 100 || 0;
    logger.info({
      message: "Performance Stats",
      totalQueries: this.queryCount,
      cacheHitRate: `${hitRate.toFixed(2)}%`,
      cacheSize: this.cache.getStats().keys,
    });
    this.queryCount = 0;
    this.cacheHits = 0;
  }

  /**
   * Query blockchain with retry logic
   */
  private async queryWithRetry(
    fromBlock: number,
    toBlock: number,
    filter: any,
    retryCount = 0
  ): Promise<ethers.Log[]> {
    try {
      return await this.contract.queryFilter(filter, fromBlock, toBlock);
    } catch (error) {
      if (retryCount < MAX_RETRIES) {
        logger.warn(`Retrying query (${retryCount + 1}/${MAX_RETRIES})...`);
        // Add a small delay before retrying
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (retryCount + 1))
        );
        return this.queryWithRetry(fromBlock, toBlock, filter, retryCount + 1);
      }
      logger.error(`Failed after ${MAX_RETRIES} retries:`, error);
      return [];
    }
  }

  /**
   * Gets accurate block number for a date using binary search
   */
  private async getAccurateBlockForDate(targetDate: Date): Promise<number> {
    // Get the current block and its timestamp
    const currentBlock = await this.provider.getBlockNumber();
    const latestBlock = await this.provider.getBlock(currentBlock);

    if (!latestBlock || !latestBlock.timestamp) {
      throw new Error("Failed to get latest block timestamp");
    }

    const targetTimestamp = Math.floor(targetDate.getTime() / 1000);

    // If target date is in the future or very close to now
    if (targetTimestamp >= latestBlock.timestamp) {
      return currentBlock;
    }

    // Binary search to find the closest block to the target timestamp
    let low = 1; // Start from genesis block
    let high = currentBlock;
    let bestBlock = high;
    let bestDiff = Math.abs(latestBlock.timestamp - targetTimestamp);

    // Use a reasonable number of iterations for binary search
    const MAX_ITERATIONS = 20;
    let iterations = 0;

    while (low <= high && iterations < MAX_ITERATIONS) {
      iterations++;
      const mid = Math.floor((low + high) / 2);

      try {
        const midBlock = await this.provider.getBlock(mid);

        if (!midBlock || !midBlock.timestamp) {
          // If we can't get this block, move our search window
          low = mid + 1;
          continue;
        }

        const diff = Math.abs(midBlock.timestamp - targetTimestamp);

        // Keep track of the best match so far
        if (diff < bestDiff) {
          bestDiff = diff;
          bestBlock = mid;
        }

        if (midBlock.timestamp === targetTimestamp) {
          // Exact match, very unlikely but possible
          return mid;
        } else if (midBlock.timestamp < targetTimestamp) {
          // Block is too early, search higher
          low = mid + 1;
        } else {
          // Block is too late, search lower
          high = mid - 1;
        }
      } catch (error) {
        // If we hit an error, just continue with a smaller search window
        low = mid + 1;
      }
    }

    logger.info(
      `Best block match for ${targetDate.toISOString()} is ${bestBlock} (diff: ${bestDiff} seconds)`
    );
    return bestBlock;
  }

  /**
   * Check for activity in a specific block range
   */
  private async checkActivityInRange(
    address: string,
    startBlock: number,
    endBlock: number
  ): Promise<boolean> {
    logger.info(
      `Checking activity for ${address} from block ${startBlock} to ${endBlock}`
    );

    const ranges: { from: number; to: number }[] = [];

    // Ensure startBlock <= endBlock
    if (startBlock > endBlock) {
      [startBlock, endBlock] = [endBlock, startBlock];
    }

    // Split the range into smaller chunks
    for (let from = startBlock; from < endBlock; from += BLOCK_RANGE) {
      ranges.push({
        from,
        to: Math.min(from + BLOCK_RANGE, endBlock),
      });
    }

    let foundActivity = false;

    // Process ranges sequentially to avoid overwhelming the RPC
    for (const { from, to } of ranges) {
      try {
        // Check for outgoing transfers
        const sentLogs = await this.queryWithRetry(
          from,
          to,
          this.contract.filters.Transfer(address)
        );

        // Check for incoming transfers
        const receivedLogs = await this.queryWithRetry(
          from,
          to,
          this.contract.filters.Transfer(null, address)
        );

        if (sentLogs.length > 0 || receivedLogs.length > 0) {
          logger.info(
            `Found activity for ${address} in block range ${from}-${to}: ${sentLogs.length} sent, ${receivedLogs.length} received`
          );
          foundActivity = true;
          break; // Exit early once we find activity
        }
      } catch (error) {
        logger.error(`Error checking range ${from}-${to}:`, error);
        // Continue to next range even if this one fails
      }
    }

    return foundActivity;
  }

  /**
   * Check if an address has interacted with the contract within a specific time range
   */
  async hasInteractedInTimeRange(
    address: string,
    startDate: Date,
    endDate: Date
  ): Promise<boolean> {
    const start = performance.now();
    const normalizedAddress = address.toLowerCase();

    this.queryCount++;

    // Create a unique cache key for this address + time range
    const cacheKey = `${normalizedAddress}_${startDate.getTime()}_${endDate.getTime()}`;

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      this.cacheHits++;
      logger.info(
        `Cache hit for ${cacheKey}, time: ${performance.now() - start}ms`
      );
      return cached as boolean;
    }

    try {
      // First check if the address is a minter - this is independent of time range
      const isMinter = await this.checkMinterRole(normalizedAddress);
      if (isMinter) {
        this.cache.set(cacheKey, true);
        logger.info(
          `Address ${normalizedAddress} is minter, time: ${
            performance.now() - start
          }ms`
        );
        return true;
      }

      // Convert dates to block numbers using the more accurate method
      logger.info(
        `Converting dates to blocks: ${startDate.toISOString()} - ${endDate.toISOString()}`
      );
      const startBlock = await this.getAccurateBlockForDate(startDate);
      const endBlock = await this.getAccurateBlockForDate(endDate);

      logger.info(
        `Date range ${startDate.toISOString()} to ${endDate.toISOString()} corresponds to blocks ${startBlock} to ${endBlock}`
      );

      // Check if the address had activity in the specified block range
      const hasActivity = await this.checkActivityInRange(
        normalizedAddress,
        startBlock,
        endBlock
      );

      // Cache and return the result
      this.cache.set(cacheKey, hasActivity);
      logger.info(
        `Activity check result for ${normalizedAddress} in time range: ${hasActivity}, time: ${
          performance.now() - start
        }ms`
      );
      return hasActivity;
    } catch (error) {
      logger.error("Error checking interactions in time range:", error);
      throw new Error("Failed to verify contract interactions in time range");
    }
  }

  /**
   * Check if an address has ever interacted with the contract
   */
  async hasInteracted(address: string): Promise<boolean> {
    const start = performance.now();
    const normalizedAddress = address.toLowerCase();

    this.queryCount++;

    const cached = this.cache.get(normalizedAddress);
    if (cached !== undefined) {
      this.cacheHits++;
      logger.info(
        `Cache hit for ${normalizedAddress}, time: ${
          performance.now() - start
        }ms`
      );
      return cached as boolean;
    }

    try {
      const currentBlock = await this.provider.getBlockNumber();

      // First check if the address is a minter
      const isMinter = await this.checkMinterRole(normalizedAddress);
      if (isMinter) {
        this.cache.set(normalizedAddress, true);
        logger.info(
          `Address ${normalizedAddress} is minter, time: ${
            performance.now() - start
          }ms`
        );
        return true;
      }

      // Check recent activity first (faster)
      const hasRecentActivity = await this.checkActivityInRange(
        normalizedAddress,
        currentBlock - RECENT_BLOCKS,
        currentBlock
      );

      if (hasRecentActivity) {
        this.cache.set(normalizedAddress, true);
        logger.info(
          `Found recent activity for ${normalizedAddress}, time: ${
            performance.now() - start
          }ms`
        );
        return true;
      }

      // Check older activity if needed
      const startBlock = Math.max(currentBlock - 50000, 7787595);
      const hasOlderActivity = await this.checkActivityInRange(
        normalizedAddress,
        startBlock,
        currentBlock - RECENT_BLOCKS
      );

      if (hasOlderActivity) {
        this.cache.set(normalizedAddress, true);
        logger.info(
          `Found older activity for ${normalizedAddress}, time: ${
            performance.now() - start
          }ms`
        );
        return true;
      }

      // No activity found
      this.cache.set(normalizedAddress, false);
      logger.info(
        `No activity found for ${normalizedAddress}, time: ${
          performance.now() - start
        }ms`
      );
      return false;
    } catch (error) {
      logger.error("Error checking interactions:", error);
      throw new Error("Failed to verify contract interactions");
    }
  }

  /**
   * Check if an address has the minter role
   */
  private async checkMinterRole(address: string): Promise<boolean> {
    try {
      const currentMinter = await this.contract.minter();
      return currentMinter.toLowerCase() === address.toLowerCase();
    } catch (error) {
      logger.error("Error checking minter role:", error);
      return false;
    }
  }

  /**
   * Clear the cache
   */
  public clearCache(): void {
    try {
      this.cache.flushAll();
      logger.info("Cache cleared successfully");
    } catch (error) {
      logger.error("Error clearing cache:", error);
    }
  }
}
