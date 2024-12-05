// import { ethers } from "ethers";
// import config from "../config/env";
// import logger from "../utils/logger";
// import NodeCache from "node-cache";
// import { performance } from "perf_hooks";

// const ABI = [
//   "event Transfer(address indexed from, address indexed to, uint256 value)",
//   "event Approval(address indexed owner, address indexed spender, uint256 value)",
//   "function minter() view returns (address)",
// ];

// const BLOCK_RANGE = 1000;
// const RECENT_BLOCKS = 1800; // 6 hours
// const CACHE_TTL = 86400;
// const MAX_RETRIES = 2;

// export class BlockchainService {
//   private provider: ethers.JsonRpcProvider;
//   private contract: ethers.Contract;
//   private cache: NodeCache;
//   private queryCount: number = 0;
//   private cacheHits: number = 0;

//   constructor() {
//     this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
//     this.contract = new ethers.Contract(
//       config.aerodromeAddress,
//       ABI,
//       this.provider
//     );
//     this.cache = new NodeCache({
//       stdTTL: CACHE_TTL,
//       checkperiod: 600,
//       useClones: false,
//     });

//     setInterval(() => this.logStats(), 10800000); // Log stats hourly
//   }

//   private logStats() {
//     const hitRate = (this.cacheHits / this.queryCount) * 100 || 0;
//     logger.info({
//       message: "Performance Stats",
//       totalQueries: this.queryCount,
//       cacheHitRate: `${hitRate.toFixed(2)}%`,
//       cacheSize: this.cache.getStats().keys,
//     });
//     this.queryCount = 0;
//     this.cacheHits = 0;
//   }

//   private async queryWithRetry(
//     fromBlock: number,
//     toBlock: number,
//     filter: any,
//     retryCount = 0
//   ): Promise<ethers.Log[]> {
//     try {
//       return await this.contract.queryFilter(filter, fromBlock, toBlock);
//     } catch (error) {
//       if (retryCount < MAX_RETRIES) {
//         return this.queryWithRetry(fromBlock, toBlock, filter, retryCount + 1);
//       }
//       logger.error(`Failed after ${MAX_RETRIES} retries:`, error);
//       return [];
//     }
//   }

//   private async checkRecentActivity(
//     address: string,
//     currentBlock: number
//   ): Promise<boolean> {
//     const recentStartBlock = currentBlock - RECENT_BLOCKS;

//     const [transferLogs, receiveLogs] = await Promise.all([
//       this.queryWithRetry(
//         recentStartBlock,
//         currentBlock,
//         this.contract.filters.Transfer(address)
//       ),
//       this.queryWithRetry(
//         recentStartBlock,
//         currentBlock,
//         this.contract.filters.Transfer(null, address)
//       ),
//     ]);

//     return transferLogs.length > 0 || receiveLogs.length > 0;
//   }

//   private async checkBlockRange(
//     address: string,
//     startBlock: number,
//     endBlock: number
//   ): Promise<boolean> {
//     const ranges: { from: number; to: number }[] = [];

//     for (let from = startBlock; from < endBlock; from += BLOCK_RANGE) {
//       ranges.push({
//         from,
//         to: Math.min(from + BLOCK_RANGE, endBlock),
//       });
//     }

//     const queries = ranges.map(({ from, to }) =>
//       Promise.all([
//         this.queryWithRetry(from, to, this.contract.filters.Transfer(address)),
//         this.queryWithRetry(
//           from,
//           to,
//           this.contract.filters.Transfer(null, address)
//         ),
//       ])
//     );

//     const results = await Promise.all(queries);
//     return results.some(
//       ([logs1, logs2]) => logs1.length > 0 || logs2.length > 0
//     );
//   }

//   async hasInteracted(address: string): Promise<boolean> {
//     const start = performance.now();
//     const normalizedAddress = address.toLowerCase();

//     this.queryCount++;

//     const cached = this.cache.get(normalizedAddress);
//     if (cached !== undefined) {
//       this.cacheHits++;
//       logger.info(
//         `Cache hit for ${normalizedAddress}, time: ${
//           performance.now() - start
//         }ms`
//       );
//       return cached as boolean;
//     }

//     try {
//       const currentBlock = await this.provider.getBlockNumber();

//       // Check recent blocks first
//       const hasRecentActivity = await this.checkRecentActivity(
//         normalizedAddress,
//         currentBlock
//       );
//       if (hasRecentActivity) {
//         this.cache.set(normalizedAddress, true);
//         logger.info(
//           `Found recent activity, time: ${performance.now() - start}ms`
//         );
//         return true;
//       }

//       // Check older blocks
//       const startBlock = Math.max(currentBlock - 50000, 7787595);
//       const hasOlderActivity = await this.checkBlockRange(
//         normalizedAddress,
//         startBlock,
//         currentBlock - RECENT_BLOCKS
//       );

//       if (hasOlderActivity) {
//         this.cache.set(normalizedAddress, true);
//         logger.info(
//           `Found older activity, time: ${performance.now() - start}ms`
//         );
//         return true;
//       }

//       // Check minter role as last resort
//       const isMinter = await this.checkMinterRole(normalizedAddress);
//       this.cache.set(normalizedAddress, isMinter);

//       logger.info(`Completed check, time: ${performance.now() - start}ms`);
//       return isMinter;
//     } catch (error) {
//       logger.error("Error checking interactions:", error);
//       throw new Error("Failed to verify contract interactions");
//     }
//   }

//   private async checkMinterRole(address: string): Promise<boolean> {
//     try {
//       const currentMinter = await this.contract.minter();
//       return currentMinter.toLowerCase() === address.toLowerCase();
//     } catch (error) {
//       return false;
//     }
//   }
// }

import { ethers } from "ethers";
import config from "../config/env";
import logger from "../utils/logger";
import NodeCache from "node-cache";
import { performance } from "perf_hooks";

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

const BLOCK_RANGE = 1000;
const RECENT_BLOCKS = 1800;
const CACHE_TTL = 86400;
const MAX_RETRIES = 2;

export class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private cache: NodeCache;
  private queryCount: number = 0;
  private cacheHits: number = 0;

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

    setInterval(() => this.logStats(), 10800000); // 3 hours
  }

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
        return this.queryWithRetry(fromBlock, toBlock, filter, retryCount + 1);
      }
      logger.error(`Failed after ${MAX_RETRIES} retries:`, error);
      return [];
    }
  }

  private async checkRecentActivity(
    address: string,
    currentBlock: number
  ): Promise<boolean> {
    const recentStartBlock = currentBlock - RECENT_BLOCKS;

    const [transferLogs, receiveLogs] = await Promise.all([
      this.queryWithRetry(
        recentStartBlock,
        currentBlock,
        this.contract.filters.Transfer(address)
      ),
      this.queryWithRetry(
        recentStartBlock,
        currentBlock,
        this.contract.filters.Transfer(null, address)
      ),
    ]);

    return transferLogs.length > 0 || receiveLogs.length > 0;
  }

  private async checkBlockRange(
    address: string,
    startBlock: number,
    endBlock: number
  ): Promise<boolean> {
    const ranges: { from: number; to: number }[] = [];

    for (let from = startBlock; from < endBlock; from += BLOCK_RANGE) {
      ranges.push({
        from,
        to: Math.min(from + BLOCK_RANGE, endBlock),
      });
    }

    const queries = ranges.map(({ from, to }) =>
      Promise.all([
        this.queryWithRetry(from, to, this.contract.filters.Transfer(address)),
        this.queryWithRetry(
          from,
          to,
          this.contract.filters.Transfer(null, address)
        ),
      ])
    );

    const results = await Promise.all(queries);
    return results.some(
      ([logs1, logs2]) => logs1.length > 0 || logs2.length > 0
    );
  }

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

      const hasRecentActivity = await this.checkRecentActivity(
        normalizedAddress,
        currentBlock
      );
      if (hasRecentActivity) {
        this.cache.set(normalizedAddress, true);
        logger.info(
          `Found recent activity, time: ${performance.now() - start}ms`
        );
        return true;
      }

      const startBlock = Math.max(currentBlock - 50000, 7787595);
      const hasOlderActivity = await this.checkBlockRange(
        normalizedAddress,
        startBlock,
        currentBlock - RECENT_BLOCKS
      );

      if (hasOlderActivity) {
        this.cache.set(normalizedAddress, true);
        logger.info(
          `Found older activity, time: ${performance.now() - start}ms`
        );
        return true;
      }

      const isMinter = await this.checkMinterRole(normalizedAddress);
      this.cache.set(normalizedAddress, isMinter);

      logger.info(`Completed check, time: ${performance.now() - start}ms`);
      return isMinter;
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
      return false;
    }
  }
}
