import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import joi from "joi";
import logger from "../utils/logger";

// Load environment variables
dotenv.config();

// Define the schema for environment variables
const envSchema = joi
  .object({
    NODE_ENV: joi
      .string()
      .valid("development", "production", "test")
      .required(),
    PORT: joi.number().default(3001),
    CONFIG_PATH: joi.string().default("./src/config/contracts.json"),
  })
  .unknown();

// Validate environment variables
const { value: env, error } = envSchema.validate(process.env);
if (error) {
  throw new Error(`Environment validation error: ${error.message}`);
}

// Define the campaign schema for validation
const campaignSchema = joi.object({
  name: joi.string().required(),
  startDate: joi.string().required(),
  endDate: joi.string().required(),
  description: joi.string().allow(""),
});

// Define the contract schema for validation
const contractSchema = joi.object({
  name: joi.string().required(),
  address: joi.string().required(),
  rpcUrlRef: joi.string().required(),
  fallbackRpcUrlRefs: joi.array().items(joi.string()).default([]),
  chainId: joi.number().required(),
  campaigns: joi
    .object()
    .pattern(/^[a-z0-9_]+$/, campaignSchema)
    .default({}),
});

// Define the config schema for validation
const configSchema = joi.object({
  contracts: joi
    .object()
    .pattern(/^[a-z0-9_]+$/, contractSchema)
    .required(),
});

/**
 * Interface for a campaign configuration
 */
export interface ICampaign {
  name: string;
  startDate: string;
  endDate: string;
  description: string;
}

/**
 * Interface for a contract configuration
 */
export interface IContract {
  name: string;
  address: string;
  rpcUrl: string;
  fallbackRpcUrls: string[];
  chainId: number;
  campaigns: Record<string, ICampaign>;
}

/**
 * Interface for the complete configuration
 */
export interface IConfig {
  contracts: Record<string, IContract>;
}

/**
 * Class to manage contract configurations
 * Loads contract data from JSON file with RPC URLs from environment variables
 */
class ConfigLoader {
  private config: IConfig;
  private configPath: string;
  private rawConfig: any;

  constructor() {
    // Try multiple possible paths for the config file
    const configPathFromEnv =
      process.env.CONFIG_PATH || "./src/config/contracts.json";
    const possiblePaths = [
      configPathFromEnv,
      path.resolve(process.cwd(), configPathFromEnv),
      path.resolve(process.cwd(), "src/config/contracts.json"),
      path.resolve(process.cwd(), "config/contracts.json"),
      path.resolve(__dirname, "contracts.json"),
    ];

    this.configPath = this.findConfigFile(possiblePaths);
    this.rawConfig = this.loadRawConfig();
    this.config = this.processConfig(this.rawConfig);
  }

  /**
   * Find the config file in one of several possible locations
   */
  private findConfigFile(paths: string[]): string {
    for (const filePath of paths) {
      try {
        if (fs.existsSync(filePath)) {
          logger.info(`Found configuration file at: ${filePath}`);
          return filePath;
        }
      } catch (e) {
        // Continue to next path
      }
    }

    // If we get here, we couldn't find the file
    logger.error(
      `Configuration file not found. Tried paths: ${paths.join(", ")}`
    );
    throw new Error(
      `Configuration file not found. Tried paths: ${paths.join(", ")}`
    );
  }

  /**
   * Load the raw configuration file without processing
   * @returns Raw configuration data
   * @throws Error if file not found or invalid format
   */
  private loadRawConfig(): any {
    try {
      // Read and parse the config file
      const configData = fs.readFileSync(this.configPath, "utf8");
      const parsedConfig = JSON.parse(configData);

      // Validate the configuration
      const { error } = configSchema.validate(parsedConfig);
      if (error) {
        logger.error(`Configuration validation error: ${error.message}`);
        throw new Error(`Configuration validation error: ${error.message}`);
      }

      return parsedConfig;
    } catch (error) {
      logger.error(`Failed to load configuration: ${error}`);
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }

  /**
   * Process the raw configuration to replace RPC URL references with actual values
   * @param rawConfig Raw configuration data
   * @returns Processed configuration with actual RPC URLs
   * @throws Error if required environment variables are missing
   */
  private processConfig(rawConfig: any): IConfig {
    const processedConfig: IConfig = {
      contracts: {},
    };

    // Process each contract
    for (const [contractId, contractData] of Object.entries(
      rawConfig.contracts
    )) {
      const contract = contractData as any;

      // Get RPC URL from environment variables
      const rpcUrlEnvVar = contract.rpcUrlRef;
      const rpcUrl = process.env[rpcUrlEnvVar];

      if (!rpcUrl) {
        logger.error(
          `Environment variable ${rpcUrlEnvVar} not found for contract ${contractId}`
        );
        throw new Error(
          `Environment variable ${rpcUrlEnvVar} not found for contract ${contractId}`
        );
      }

      // Get fallback RPC URLs from environment variables
      const fallbackRpcUrls: string[] = [];
      for (const envVar of contract.fallbackRpcUrlRefs) {
        const fallbackUrl = process.env[envVar];
        if (fallbackUrl) {
          fallbackRpcUrls.push(fallbackUrl);
        } else {
          logger.warn(
            `Fallback RPC URL environment variable ${envVar} not found for contract ${contractId}`
          );
        }
      }

      // Add the processed contract
      processedConfig.contracts[contractId] = {
        name: contract.name,
        address: contract.address,
        rpcUrl: rpcUrl,
        fallbackRpcUrls,
        chainId: contract.chainId,
        campaigns: contract.campaigns,
      };
    }

    logger.info(
      `Loaded configuration with ${
        Object.keys(processedConfig.contracts).length
      } contracts`
    );
    return processedConfig;
  }

  /**
   * Reload the configuration file
   * @throws Error if reload fails
   */
  public reloadConfig(): void {
    try {
      this.rawConfig = this.loadRawConfig();
      this.config = this.processConfig(this.rawConfig);
      logger.info("Configuration reloaded successfully");
    } catch (error) {
      logger.error(`Failed to reload configuration: ${error}`);
      throw error;
    }
  }

  /**
   * Get a contract configuration by ID
   * @param contractId Contract identifier
   * @returns Contract configuration
   * @throws Error if contract not found
   */
  public getContractConfig(contractId: string): IContract {
    if (!contractId) {
      throw new Error("Contract ID is required");
    }

    const contract = this.config.contracts[contractId];

    if (!contract) {
      logger.error(`Contract not found: ${contractId}`);
      throw new Error(`Contract not found: ${contractId}`);
    }

    return contract;
  }

  /**
   * Get a campaign configuration by contract ID and campaign ID
   * @param contractId Contract identifier
   * @param campaignId Campaign identifier
   * @returns Campaign configuration or null if not found
   * @throws Error if contract not found
   */
  public getCampaignConfig(
    contractId: string,
    campaignId: string
  ): ICampaign | null {
    if (!contractId || !campaignId) {
      throw new Error("Both contract ID and campaign ID are required");
    }

    const contractConfig = this.getContractConfig(contractId);
    const campaign = contractConfig.campaigns[campaignId];

    if (!campaign) {
      return null;
    }

    return campaign;
  }

  /**
   * Check if a date is within a campaign period
   * @param date Date to check
   * @param contractId Contract identifier
   * @param campaignId Campaign identifier
   * @returns True if date is within campaign period
   * @throws Error if contract or campaign not found
   */
  public isWithinCampaignPeriod(
    date: Date,
    contractId: string,
    campaignId: string
  ): boolean {
    const campaign = this.getCampaignConfig(contractId, campaignId);

    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    const startDate = new Date(campaign.startDate);
    const endDate = new Date(campaign.endDate);

    return date >= startDate && date <= endDate;
  }

  /**
   * Get all available contracts
   * @returns Array of contract IDs
   */
  public getAvailableContracts(): string[] {
    return Object.keys(this.config.contracts);
  }

  /**
   * Get all campaigns for a contract
   * @param contractId Contract identifier
   * @returns Record of campaign IDs to campaign configs
   * @throws Error if contract not found
   */
  public getContractCampaigns(contractId: string): Record<string, ICampaign> {
    if (!contractId) {
      throw new Error("Contract ID is required");
    }

    const contract = this.getContractConfig(contractId);
    return contract.campaigns;
  }

  /**
   * Get environment configuration
   * @returns Environment configuration
   */
  public getEnvConfig() {
    return {
      env: env.NODE_ENV,
      port: env.PORT,
    };
  }

  /**
   * Get the raw configuration (for admin purposes only)
   * This removes sensitive RPC URLs
   * @returns Safe version of raw config
   */
  public getRawConfigSafe(): any {
    // Create a deep copy
    const safeCopy = JSON.parse(JSON.stringify(this.rawConfig));

    // Do not modify the structure, just return what is already public
    return safeCopy;
  }
}

// Create and export a singleton instance
const configLoader = new ConfigLoader();
export default configLoader;
