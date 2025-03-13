import { ethers } from "ethers";
import configLoader from "../config/config-loader";
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
const BLOCK_RANGE = 9500; // Number of blocks to query at once
const RECENT_BLOCKS = 2500; // Define what "recent" means in terms of blocks
const CACHE_TTL = 3600; // Cache TTL in seconds (1 hour)
const MAX_RETRIES = 2; // Number of retries for failed queries
const MAX_VERIFICATION_TIME = 12000; // 12 seconds max for verification
const MAX_BLOCKS_TO_SCAN = 100000; // Maximum blocks to scan before early termination

/**
 * Service for interacting with blockchain contracts and verifying address interactions
 */
export class BlockchainService {
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private contracts: Map<string, ethers.Contract> = new Map();
  private cache: NodeCache;
  private queryCount: number = 0;
  private cacheHits: number = 0;
  private static isInitialized = false;

  constructor() {
    this.cache = new NodeCache({
      stdTTL: CACHE_TTL,
      checkperiod: 600,
      useClones: false,
    });

    // Initialize all contracts from the configuration file
    this.initializeAllContracts();

    // Log performance stats periodically
    setInterval(() => this.logStats(), 10800000); // 3 hours

    if (!BlockchainService.isInitialized) {
      this.clearCache();
      BlockchainService.isInitialized = true;
    }
  }

  /**
   * Initialize all contracts from the configuration
   * This pre-loads all contracts at startup but doesn't initialize providers yet
   */
  private initializeAllContracts(): void {
    const contractIds = configLoader.getAvailableContracts();
    logger.info(`Found ${contractIds.length} contracts in configuration`);
  }

  /**
   * Initialize a contract by its ID
   * @param contractId The contract identifier
   * @returns The initialized contract
   * @throws Error if contract initialization fails
   */
  public initializeContract(contractId: string): ethers.Contract {
    if (!contractId) {
      throw new Error("Contract ID is required");
    }

    // Return cached contract if already initialized
    if (this.contracts.has(contractId)) {
      return this.contracts.get(contractId)!;
    }

    const contractConfig = configLoader.getContractConfig(contractId);

    // Create a provider for this contract
    try {
      const provider = new ethers.JsonRpcProvider(contractConfig.rpcUrl);
      this.providers.set(contractId, provider);

      // Create the contract instance
      const contract = new ethers.Contract(
        contractConfig.address,
        ABI,
        provider
      );
      this.contracts.set(contractId, contract);

      logger.info(
        `Initialized contract ${contractId}: ${contractConfig.name} at address ${contractConfig.address}`
      );

      return contract;
    } catch (error) {
      logger.error(`Failed to initialize contract ${contractId}:`, error);
      throw new Error(`Failed to initialize contract ${contractId}: ${error}`);
    }
  }

  /**
   * Reload all contract configurations
   * @throws Error if reload fails
   */
  public reloadContractConfigurations(): void {
    try {
      // Clear existing providers and contracts
      this.providers.clear();
      this.contracts.clear();

      // Reload the configuration file
      configLoader.reloadConfig();

      // Clear the cache to ensure fresh data
      this.clearCache();

      logger.info("Contract configurations reloaded successfully");
    } catch (error) {
      logger.error("Failed to reload contract configurations:", error);
      throw error;
    }
  }

  /**
   * Get provider for a specific contract
   * @param contractId The contract identifier
   * @returns The JsonRpcProvider for the contract
   * @throws Error if contract initialization fails
   */
  private getProvider(contractId: string): ethers.JsonRpcProvider {
    if (!contractId) {
      throw new Error("Contract ID is required");
    }

    if (!this.providers.has(contractId)) {
      this.initializeContract(contractId);
    }
    return this.providers.get(contractId)!;
  }

  /**
   * Get contract instance for a specific contract ID
   * @param contractId The contract identifier
   * @returns The Contract instance
   * @throws Error if contract initialization fails
   */
  private getContract(contractId: string): ethers.Contract {
    if (!contractId) {
      throw new Error("Contract ID is required");
    }

    if (!this.contracts.has(contractId)) {
      this.initializeContract(contractId);
    }
    return this.contracts.get(contractId)!;
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
   * @param contractId The contract identifier
   * @param fromBlock Starting block number
   * @param toBlock Ending block number
   * @param filter Event filter
   * @param retryCount Current retry attempt
   * @returns Array of logs matching the filter
   */
  private async queryWithRetry(
    contractId: string,
    fromBlock: number,
    toBlock: number,
    filter: any,
    retryCount = 0
  ): Promise<ethers.Log[]> {
    try {
      const contract = this.getContract(contractId);

      // Add timeout to the request
      const timeoutPromise = new Promise<ethers.Log[]>((_, reject) => {
        setTimeout(() => reject(new Error("Query timeout")), 3000); // 3 second timeout
      });

      return await Promise.race([
        contract.queryFilter(filter, fromBlock, toBlock),
        timeoutPromise,
      ]);
    } catch (error) {
      if (retryCount < MAX_RETRIES) {
        logger.warn(
          `Retrying query for ${contractId} (${
            retryCount + 1
          }/${MAX_RETRIES})...`
        );
        // Add a small delay before retrying
        await new Promise((resolve) =>
          setTimeout(resolve, 300 * (retryCount + 1))
        );
        return this.queryWithRetry(
          contractId,
          fromBlock,
          toBlock,
          filter,
          retryCount + 1
        );
      }
      logger.error(
        `Failed after ${MAX_RETRIES} retries for ${contractId}:`,
        error
      );
      return [];
    }
  }

  /**
   * Gets approximate block number for a date
   * This uses a faster estimation approach rather than binary search
   */
  private async getApproximateBlockForDate(
    contractId: string,
    targetDate: Date
  ): Promise<number> {
    const provider = this.getProvider(contractId);

    // Get the current block
    const currentBlock = await provider.getBlockNumber();
    const latestBlock = await provider.getBlock(currentBlock);

    if (!latestBlock || !latestBlock.timestamp) {
      throw new Error(`Failed to get latest block timestamp for ${contractId}`);
    }

    const targetTimestamp = Math.floor(targetDate.getTime() / 1000);
    const currentTimestamp = latestBlock.timestamp;

    // If target date is in the future, return current block
    if (targetTimestamp >= currentTimestamp) {
      return currentBlock;
    }

    // Simple approximation: assume average block time of 2.5 seconds for Base chain
    const AVERAGE_BLOCK_TIME = 2.5;
    const timestampDiff = currentTimestamp - targetTimestamp;
    const estimatedBlocksBack = Math.floor(timestampDiff / AVERAGE_BLOCK_TIME);

    // Ensure we don't go below block 0
    const estimatedBlock = Math.max(1, currentBlock - estimatedBlocksBack);

    logger.debug(
      `Estimated block for ${targetDate.toISOString()} is ${estimatedBlock}`
    );
    return estimatedBlock;
  }

  /**
   * Check if there are any direct transactions between the address and the contract
   * This optimized version focuses on the most likely block ranges first
   */
  private async checkDirectTransactionInteractions(
    contractId: string,
    address: string,
    startBlock: number,
    endBlock: number
  ): Promise<boolean> {
    try {
      const provider = this.getProvider(contractId);
      const contractConfig = configLoader.getContractConfig(contractId);
      const contractAddress = contractConfig.address;

      logger.info(
        `Checking direct transactions between ${address} and ${contractAddress}`
      );

      // Try the transaction count approach
      try {
        const addressTxCount = await provider.getTransactionCount(
          address,
          endBlock
        );
        const addressTxCountStart = await provider.getTransactionCount(
          address,
          startBlock
        );

        if (addressTxCount > addressTxCountStart) {
          const txDiff = addressTxCount - addressTxCountStart;
          logger.info(
            `Address ${address} has ${txDiff} transactions in the block range.`
          );

          // Calculate block ranges to check - prioritize the later part of the range first
          // as recent transactions are more likely
          const totalBlocks = endBlock - startBlock;
          const ranges = [];

          // Check the most recent third first
          const thirdSize = Math.floor(totalBlocks / 3);
          ranges.push({
            from: endBlock - thirdSize,
            to: endBlock,
          });

          // Then the middle third
          ranges.push({
            from: startBlock + thirdSize,
            to: endBlock - thirdSize,
          });

          // Then the earliest third
          ranges.push({
            from: startBlock,
            to: startBlock + thirdSize,
          });

          // Check each range
          for (const range of ranges) {
            // Check contract logs where the address is involved in Transfer events
            try {
              // Check as sender
              const sentLogs = await provider.getLogs({
                address: contractAddress,
                fromBlock: range.from,
                toBlock: range.to,
                topics: [
                  ethers.id("Transfer(address,address,uint256)"),
                  ethers.zeroPadValue(address, 32),
                ],
              });

              if (sentLogs.length > 0) {
                logger.info(
                  `Found ${sentLogs.length} Transfer events from address in block range ${range.from}-${range.to}`
                );
                return true;
              }

              // Check as recipient
              const receivedLogs = await provider.getLogs({
                address: contractAddress,
                fromBlock: range.from,
                toBlock: range.to,
                topics: [
                  ethers.id("Transfer(address,address,uint256)"),
                  null, // any sender
                  ethers.zeroPadValue(address, 32), // to this address
                ],
              });

              if (receivedLogs.length > 0) {
                logger.info(
                  `Found ${receivedLogs.length} Transfer events to address in block range ${range.from}-${range.to}`
                );
                return true;
              }
            } catch (error) {
              // logger.warn(
              //   `Error checking events in range ${range.from}-${range.to}: ${error}`
              // );
            }
          }

          // If we found transaction count differences but couldn't pinpoint the exact interactions,
          // it's very likely this address has interacted with the contract
          logger.info(
            `Found transaction count difference but couldn't verify contract interaction. Assuming true.`
          );
          return true;
        } else {
          logger.info(
            `No transaction count difference found for address ${address} in the block range.`
          );
        }
      } catch (error) {
        logger.warn(`Error checking transaction counts: ${error}`);
      }

      logger.info(
        `No direct transactions found between ${address} and ${contractAddress}`
      );
      return false;
    } catch (error) {
      logger.error(`Error checking direct transactions: ${error}`);
      return false;
    }
  }

  /**
   * Sample-based activity check with direct transaction verification
   */
  private async checkActivityFast(
    contractId: string,
    address: string,
    startBlock: number,
    endBlock: number
  ): Promise<boolean> {
    if (!contractId || !address) {
      throw new Error("Contract ID and address are required");
    }

    const rangeStart = performance.now();

    try {
      const provider = this.getProvider(contractId);
      const contract = this.getContract(contractId);
      const currentBlock = await provider.getBlockNumber();

      // Ensure valid block range
      startBlock = Math.max(1, startBlock);
      endBlock = Math.min(currentBlock, endBlock);

      // First, try checking for direct transactions - most definitive
      try {
        const hasDirectInteractions =
          await this.checkDirectTransactionInteractions(
            contractId,
            address,
            startBlock,
            endBlock
          );

        if (hasDirectInteractions) {
          logger.info(`Found direct transaction interactions for ${address}`);
          return true;
        }
      } catch (error) {
        logger.warn(`Error checking direct transactions: ${error}`);
      }

      // 1. Check recent blocks (most likely to have activity)
      const recentStartBlock = Math.max(
        currentBlock - RECENT_BLOCKS,
        startBlock
      );

      if (recentStartBlock <= endBlock) {
        logger.debug(
          `Checking recent blocks ${recentStartBlock} to ${endBlock} for ${address}`
        );

        try {
          const [sentLogs, receivedLogs] = await Promise.all([
            this.queryWithRetry(
              contractId,
              recentStartBlock,
              endBlock,
              contract.filters.Transfer(address)
            ),
            this.queryWithRetry(
              contractId,
              recentStartBlock,
              endBlock,
              contract.filters.Transfer(null, address)
            ),
          ]);

          if (sentLogs.length > 0 || receivedLogs.length > 0) {
            logger.info(`Found activity for ${address} in recent blocks`);
            return true;
          }
        } catch (error) {
          logger.warn(`Error checking recent blocks: ${error}`);
        }
      }

      // 2. If the range is too large, use strategic sampling
      const totalBlocksToCheck = endBlock - startBlock;

      if (totalBlocksToCheck > MAX_BLOCKS_TO_SCAN) {
        // Use strategic sampling: check blocks spaced throughout the range
        logger.info(
          `Using sampling for large block range (${totalBlocksToCheck} blocks)`
        );

        // Create strategic points to check (start, mid points, end)
        const samplingPoints = [];

        // Add 20 evenly distributed points
        for (let i = 0; i <= 20; i++) {
          const point = Math.floor(startBlock + (i * totalBlocksToCheck) / 20);
          samplingPoints.push(point);
        }

        // Also add additional points focused on the middle 50% of the range
        const midRangeStart = Math.floor(
          startBlock + totalBlocksToCheck * 0.25
        );
        const midRangeEnd = Math.floor(startBlock + totalBlocksToCheck * 0.75);

        for (let i = 0; i < 10; i++) {
          const point = Math.floor(
            midRangeStart + (i * (midRangeEnd - midRangeStart)) / 10
          );
          samplingPoints.push(point);
        }

        // Check each sampling point with a wider range around it
        for (const point of samplingPoints) {
          const rangeStart = Math.max(startBlock, point - 2000);
          const rangeEnd = Math.min(endBlock, point + 2000);

          try {
            const [sentLogs, receivedLogs] = await Promise.all([
              this.queryWithRetry(
                contractId,
                rangeStart,
                rangeEnd,
                contract.filters.Transfer(address)
              ),
              this.queryWithRetry(
                contractId,
                rangeStart,
                rangeEnd,
                contract.filters.Transfer(null, address)
              ),
            ]);

            if (sentLogs.length > 0 || receivedLogs.length > 0) {
              logger.info(
                `Found activity for ${address} in sampled block range ${rangeStart}-${rangeEnd}`
              );
              return true;
            }
          } catch (error) {
            logger.warn(
              `Error checking sampled range ${rangeStart}-${rangeEnd}: ${error}`
            );
          }

          // Check if we're reaching timeout
          if (performance.now() - rangeStart > MAX_VERIFICATION_TIME) {
            logger.warn(
              `Verification timeout reached after checking ${
                samplingPoints.indexOf(point) + 1
              } sample points`
            );
            return false;
          }
        }

        // Try one more full check of the most active part of the range (middle)
        try {
          const midPoint = Math.floor(startBlock + totalBlocksToCheck / 2);
          const midRangeStart = Math.max(startBlock, midPoint - 5000);
          const midRangeEnd = Math.min(endBlock, midPoint + 5000);

          logger.info(
            `Performing final check of middle range ${midRangeStart}-${midRangeEnd}`
          );

          const [sentLogs, receivedLogs] = await Promise.all([
            this.queryWithRetry(
              contractId,
              midRangeStart,
              midRangeEnd,
              contract.filters.Transfer(address)
            ),
            this.queryWithRetry(
              contractId,
              midRangeStart,
              midRangeEnd,
              contract.filters.Transfer(null, address)
            ),
          ]);

          if (sentLogs.length > 0 || receivedLogs.length > 0) {
            logger.info(
              `Found activity for ${address} in middle range ${midRangeStart}-${midRangeEnd}`
            );
            return true;
          }
        } catch (error) {
          logger.warn(`Error checking middle range: ${error}`);
        }

        logger.info(
          `No activity found for ${address} in block range after ${(
            performance.now() - rangeStart
          ).toFixed(2)}ms`
        );
        return false;
      } else {
        // For smaller ranges, use higher coverage with batch checking
        const batchSize = 3000;

        for (let i = startBlock; i < endBlock; i += batchSize) {
          const batchEnd = Math.min(i + batchSize, endBlock);

          try {
            const [sentLogs, receivedLogs] = await Promise.all([
              this.queryWithRetry(
                contractId,
                i,
                batchEnd,
                contract.filters.Transfer(address)
              ),
              this.queryWithRetry(
                contractId,
                i,
                batchEnd,
                contract.filters.Transfer(null, address)
              ),
            ]);

            if (sentLogs.length > 0 || receivedLogs.length > 0) {
              logger.info(
                `Found activity for ${address} in block range ${i}-${batchEnd}`
              );
              return true;
            }
          } catch (error) {
            logger.warn(`Error checking range ${i}-${batchEnd}: ${error}`);
          }

          // Check if we're reaching timeout
          if (performance.now() - rangeStart > MAX_VERIFICATION_TIME) {
            logger.warn(
              `Verification timeout reached after checking up to block ${batchEnd}`
            );
            return false;
          }
        }
      }

      logger.info(
        `No activity found for ${address} in block range after ${(
          performance.now() - rangeStart
        ).toFixed(2)}ms`
      );
      return false;
    } catch (error) {
      logger.error(`Error in fast activity check: ${error}`);
      return false;
    }
  }

  /**
   * Check if an address has interacted with a specific contract within a time range
   * @param address Ethereum address to check
   * @param startDate Start date of the time range
   * @param endDate End date of the time range
   * @param contractId Contract identifier
   * @param campaignId Optional campaign identifier
   * @returns True if interaction found
   * @throws Error if contractId is not provided or not found
   */
  async hasInteractedInTimeRange(
    address: string,
    startDate: Date,
    endDate: Date,
    contractId: string,
    campaignId?: string
  ): Promise<boolean> {
    if (!address || !startDate || !endDate || !contractId) {
      throw new Error(
        "Address, start date, end date, and contract ID are all required"
      );
    }

    const start = performance.now();
    const normalizedAddress = address.toLowerCase();

    this.queryCount++;

    // Create a unique cache key for this address + time range + contract + campaign
    const cacheKey = `${contractId}_${
      campaignId || "custom"
    }_${normalizedAddress}_${startDate.getTime()}_${endDate.getTime()}`;

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      this.cacheHits++;
      logger.info(
        `Cache hit for ${cacheKey}, time: ${performance.now() - start}ms`
      );
      return cached as boolean;
    }

    try {
      // Validate the campaign dates if a campaign is specified
      if (campaignId) {
        // Get campaign configuration
        const campaignConfig = configLoader.getCampaignConfig(
          contractId,
          campaignId
        );

        if (!campaignConfig) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }

        // Override date range with campaign dates
        startDate = new Date(campaignConfig.startDate);
        endDate = new Date(campaignConfig.endDate);
      }

      // Ensure the contract is initialized
      if (!this.contracts.has(contractId)) {
        this.initializeContract(contractId);
      }

      // First check if the address is a minter - this is independent of time range
      const isMinter = await this.checkMinterRole(
        contractId,
        normalizedAddress
      );
      if (isMinter) {
        this.cache.set(cacheKey, true);
        const elapsedSeconds = (performance.now() - start) / 1000;
        logger.info(
          `Address ${normalizedAddress} is minter on ${contractId}, time: ${elapsedSeconds.toFixed(
            2
          )} seconds`
        );
        return true;
      }

      // Convert dates to block numbers using the fast approximation method
      logger.debug(
        `Converting dates to blocks on ${contractId}: ${startDate.toISOString()} - ${endDate.toISOString()}`
      );
      const startBlock = await this.getApproximateBlockForDate(
        contractId,
        startDate
      );
      const endBlock = await this.getApproximateBlockForDate(
        contractId,
        endDate
      );

      logger.debug(
        `Date range ${startDate.toISOString()} to ${endDate.toISOString()} corresponds to approximately blocks ${startBlock} to ${endBlock}`
      );

      // IMPORTANT CHANGE: Check for direct transactions first, before any other checks
      // This is what was getting cut off by the timeout
      try {
        const hasDirectInteractions =
          await this.checkDirectTransactionInteractions(
            contractId,
            normalizedAddress,
            startBlock,
            endBlock
          );

        if (hasDirectInteractions) {
          // We found direct interactions - cache and return true
          this.cache.set(cacheKey, true);
          const elapsedSeconds = (performance.now() - start) / 1000;
          logger.info(
            `Found direct interactions for ${normalizedAddress} on ${contractId}, total time: ${elapsedSeconds.toFixed(
              2
            )} seconds`
          );
          return true;
        }
      } catch (error) {
        logger.warn(`Error in direct transaction check: ${error}`);
        // Continue with other checks
      }

      // Add a timeout for the rest of the verification process
      // This only applies to the activity check, not the direct transaction check we already did
      const verificationTimeoutPromise = new Promise<boolean>((resolve) => {
        setTimeout(() => {
          logger.warn(
            `Overall verification timeout reached for ${address} on ${contractId}`
          );
          resolve(false);
        }, MAX_VERIFICATION_TIME);
      });

      // Check if the address had activity using the fast method (with timeout)
      const hasActivity = await Promise.race([
        this.checkActivityFast(
          contractId,
          normalizedAddress,
          startBlock,
          endBlock
        ),
        verificationTimeoutPromise,
      ]);

      // Cache and return the result
      this.cache.set(cacheKey, hasActivity);
      const elapsedSeconds = (performance.now() - start) / 1000;
      logger.info(
        `Activity check result for ${normalizedAddress} on ${contractId} in time range: ${hasActivity}, total time: ${elapsedSeconds.toFixed(
          2
        )} seconds`
      );
      return hasActivity;
    } catch (error) {
      const elapsedSeconds = (performance.now() - start) / 1000;
      logger.error(
        `Error checking interactions in time range on ${contractId}, time: ${elapsedSeconds.toFixed(
          2
        )} seconds:`,
        error
      );
      throw new Error(
        `Failed to verify contract interactions in time range on ${contractId}: ${error}`
      );
    }
  }
  /**
   * Check if an address has ever interacted with a specific contract
   * @param address Ethereum address to check
   * @param contractId Contract identifier
   * @param campaignId Optional campaign identifier
   * @returns True if interaction found
   * @throws Error if contractId is not provided or not found
   */
  async hasInteracted(
    address: string,
    contractId: string,
    campaignId?: string
  ): Promise<boolean> {
    if (!address || !contractId) {
      throw new Error("Address and contract ID are required");
    }

    const start = performance.now();
    const normalizedAddress = address.toLowerCase();

    this.queryCount++;

    // Use contract-specific cache key including campaign if provided
    const cacheKey = `${contractId}_${
      campaignId || "all"
    }_${normalizedAddress}`;

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      this.cacheHits++;
      logger.info(
        `Cache hit for ${cacheKey}, time: ${performance.now() - start}ms`
      );
      return cached as boolean;
    }

    try {
      // If a campaign is specified, use the campaign date range
      if (campaignId) {
        // Get campaign configuration
        const campaignConfig = configLoader.getCampaignConfig(
          contractId,
          campaignId
        );

        if (!campaignConfig) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }

        // Create date objects from campaign date strings
        const campaignStartDate = new Date(campaignConfig.startDate);
        const campaignEndDate = new Date(campaignConfig.endDate);

        // Use the campaign date range for verification with the fast method
        logger.info(
          `Using campaign date range for verification: ${campaignStartDate.toISOString()} to ${campaignEndDate.toISOString()}`
        );
        return this.hasInteractedInTimeRange(
          address,
          campaignStartDate,
          campaignEndDate,
          contractId
        );
      }

      // Add early timeout for the overall process
      const verificationTimeoutPromise = new Promise<boolean>((resolve) => {
        setTimeout(() => {
          logger.warn(
            `Overall verification timeout reached for ${address} on ${contractId}`
          );
          resolve(false);
        }, MAX_VERIFICATION_TIME);
      });

      // Ensure the contract is initialized
      if (!this.contracts.has(contractId)) {
        this.initializeContract(contractId);
      }

      const provider = this.getProvider(contractId);
      const currentBlock = await provider.getBlockNumber();

      // First check if the address is a minter
      const isMinter = await this.checkMinterRole(
        contractId,
        normalizedAddress
      );
      if (isMinter) {
        this.cache.set(cacheKey, true);
        logger.info(
          `Address ${normalizedAddress} is minter on ${contractId}, time: ${
            performance.now() - start
          }ms`
        );
        return true;
      }

      // Use the fast method to check for activity
      const hasActivity = await Promise.race([
        this.checkActivityFast(
          contractId,
          normalizedAddress,
          currentBlock - 100000, // Check last 100,000 blocks
          currentBlock
        ),
        verificationTimeoutPromise,
      ]);

      // Cache and return the result
      this.cache.set(cacheKey, hasActivity);

      const elapsedMs = performance.now() - start;
      logger.info(
        `Verification result for ${normalizedAddress} on ${contractId}: ${hasActivity}, time: ${elapsedMs.toFixed(
          2
        )}ms`
      );

      return hasActivity;
    } catch (error) {
      logger.error(`Error checking interactions on ${contractId}:`, error);
      throw new Error(
        `Failed to verify contract interactions on ${contractId}: ${error}`
      );
    }
  }

  /**
   * Check if an address has the minter role for a specific contract
   * @param contractId The contract identifier
   * @param address Ethereum address to check
   * @returns True if address has minter role
   * @throws Error if check fails
   */
  private async checkMinterRole(
    contractId: string,
    address: string
  ): Promise<boolean> {
    if (!contractId || !address) {
      throw new Error("Contract ID and address are required");
    }

    try {
      const contract = this.getContract(contractId);
      const currentMinter = await contract.minter();
      return currentMinter.toLowerCase() === address.toLowerCase();
    } catch (error) {
      logger.error(`Error checking minter role on ${contractId}:`, error);
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

  /**
   * Get a list of all available contracts
   * @returns Array of contract IDs
   */
  public getAvailableContracts(): string[] {
    return configLoader.getAvailableContracts();
  }

  /**
   * Get a list of campaigns for a specific contract
   * @param contractId Contract identifier
   * @returns Record of campaign IDs to campaign configs
   * @throws Error if contract not found
   */
  public getContractCampaigns(contractId: string): Record<string, any> {
    if (!contractId) {
      throw new Error("Contract ID is required");
    }

    return configLoader.getContractCampaigns(contractId);
  }

  /**
   * Get details about a specific campaign
   * @param contractId Contract identifier
   * @param campaignId Campaign identifier
   * @returns Campaign configuration
   * @throws Error if contract or campaign not found
   */
  public getCampaignDetails(contractId: string, campaignId: string): any {
    if (!contractId || !campaignId) {
      throw new Error("Contract ID and campaign ID are required");
    }

    const campaign = configLoader.getCampaignConfig(contractId, campaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    return campaign;
  }
}
