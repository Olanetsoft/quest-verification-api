# Quest Verification API

A flexible API service for verifying on-chain interactions for various partner campaigns.

## Overview

This service provides verification endpoints that partners like Galxe can use to check if a wallet address has interacted with specific blockchain contracts within defined timeframes. The API is designed to be fully customizable, supporting multiple partners and campaigns without requiring code changes.

## Table of Contents

- [Features](#features)
- [Setup Instructions](#setup-instructions)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Sample Requests](#sample-requests)
- [Adding New Partners or Campaigns](#adding-new-partners-or-campaigns)
- [Troubleshooting](#troubleshooting)
- [FAQs](#faqs)

## Features

- Verify if an address has interacted with specific contracts
- Support for time-bounded verification (campaigns with start/end dates)
- Configuration-based setup with no code changes required for new partners
- RPC URL management through environment variables for security
- Caching for improved performance
- Comprehensive logging for debugging

## Setup Instructions

### Prerequisites

- Node.js v18+
- npm or yarn

### Installation

1. Clone the repository:

   ```
   git clone https://github.com/olanetsoft/quest-verification-api.git
   cd quest-verification-api
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Copy the example environment file:

   ```
   cp .env.example .env
   ```

4. Edit the `.env` file to add your RPC URLs and other settings.

5. Start the service:
   ```
   npm run dev
   ```

## Configuration

The API is configured through two main files:

### 1. Environment Variables (.env)

Contains sensitive information like RPC URLs:

```
NODE_ENV=development
PORT=3001

# Config path
CONFIG_PATH=./config/contracts.json

# RPC URLs
BASE_RPC_URL=https://your-base-rpc-provider.com
ETH_RPC_URL=https://your-ethereum-rpc-provider.com
ARB_RPC_URL=https://your-arbitrum-rpc-provider.com

# Fallback RPC URLs
BASE_FALLBACK_RPC_1=https://base-rpc.publicnode.com
```

### 2. Contracts Configuration (contracts.json)

Contains partner contract details and campaign information:

```json
{
  "contracts": {
    "doge_base_aerodome": {
      "name": "D.O.G.E on Base via Aerodrome",
      "address": "0x940181a94a35a4569e4529a3cdfb74e38fd98631",
      "rpcUrlRef": "BASE_RPC_URL",
      "fallbackRpcUrlRefs": ["BASE_FALLBACK_RPC_1", "BASE_FALLBACK_RPC_2"],
      "chainId": 8453,
      "campaigns": {
        "doge_feb_2025": {
          "name": "D.O.G.E December 2024 Campaign",
          "startDate": "2024-12-12T00:00:00Z",
          "endDate": "2024-12-27T23:59:59Z",
          "description": "D.O.G.E campaign on Aerodrome for December 2024"
        }
      }
    }
  }
}
```

Key points:

- `rpcUrlRef` references an environment variable containing the actual RPC URL
- Each contract can have multiple campaigns with their own date ranges
- All IDs should be lowercase with underscores

## API Endpoints

### Verify Interaction

Checks if an address has interacted with a contract.

```
GET /api/verify/:address?contract=contract_id&campaign=campaign_id
```

Parameters:

- `:address` - Ethereum wallet address to check
- `contract` - (Required) Contract ID from configuration
- `campaign` - (Optional) Campaign ID for specific time-bounded verification

### Verify Interaction in Time Range

Checks if an address has interacted with a contract within a specific date range.

```
GET /api/verify-in-range/:address?contract=contract_id&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

Parameters:

- `:address` - Ethereum wallet address to check
- `contract` - (Required) Contract ID from configuration
- `startDate` - (Required if campaign not specified) Start date in YYYY-MM-DD format
- `endDate` - (Required if campaign not specified) End date in YYYY-MM-DD format
- `campaign` - (Optional) Campaign ID; if provided, startDate and endDate are ignored

### List Contracts and Campaigns

Returns all available contracts and their campaigns.

```
GET /api/contracts
```

### Get Campaign Details

Returns details for a specific campaign.

```
GET /api/contracts/:contractId/campaigns/:campaignId
```

### Reload Configuration

Reloads the configuration from the JSON file without restarting the service.

```
GET /api/reload-config
```

### Clear Cache

Clears the verification cache to force fresh blockchain queries.

```
GET /api/clear-cache
```

## Sample Requests

### Example 1: Verify DOGE Campaign Interaction

```
GET /api/verify/0x1234567890abcdef1234567890abcdef12345678?contract=doge_base_aerodome&campaign=doge_feb_2025
```

Response:

```json
{
  "result": 1
}
```

### Example 2: Verify FLOKI Bridge Campaign Interaction

```
GET /api/verify/0x1234567890abcdef1234567890abcdef12345678?contract=floki_base&campaign=floki_bridge_campaign
```

Response:

```json
{
  "result": 0
}
```

### Example 3: Verify Custom Date Range

```
GET /api/verify-in-range/0x1234567890abcdef1234567890abcdef12345678?contract=printr_arbitrum&startDate=2025-02-15&endDate=2025-03-07
```

Response:

```json
{
  "result": 1
}
```

## Adding New Partners or Campaigns

### Process Overview

1. Submit a PR that modifies `contracts.json`
2. Ensure environment variables are set for any new RPC URLs
3. Test the changes
4. After merger, reload the API configuration using the reload endpoint

### How to Add a New Partner

1. Edit `contracts.json` to add a new contract:

```json
"mynew_partner": {
  "name": "My New Partner on Arbitrum",
  "address": "0x1234567890abcdef1234567890abcdef12345678",
  "rpcUrlRef": "ARB_RPC_URL",
  "fallbackRpcUrlRefs": [],
  "chainId": 42161,
  "campaigns": {}
}
```

2. Ensure the referenced RPC URL is available in the environment variables

### How to Add a New Campaign

1. Edit `contracts.json` to add a campaign to an existing contract:

```json
"campaigns": {
  "partner_march_campaign": {
    "name": "My Partner March Campaign",
    "startDate": "2025-03-01T00:00:00Z",
    "endDate": "2025-03-31T23:59:59Z",
    "description": "March 2025 promotional campaign"
  }
}
```

2. Submit the PR for review
3. After approval and deployment, the campaign will be available immediately

## Troubleshooting

### Common Issues and Solutions

1. **"Contract not found" error**

   - Check if the contract ID is correct and exists in `contracts.json`
   - Make sure the configuration has been reloaded after changes

2. **"Campaign not found" error**

   - Verify the campaign ID exists for the specified contract
   - Check for typos in the contract or campaign ID

3. **RPC errors**

   - Ensure the RPC URL environment variables are set correctly
   - Check if the RPC provider is operational
   - Try using a fallback RPC if available

4. **Verification always returns 0**
   - Confirm the address has actually interacted with the contract
   - Check if you're verifying within the correct campaign dates
   - Try clearing the cache with the clear-cache endpoint

### Logs

The service logs are available in:

- Development: Console output
- Production: `logs/combined.log` and `logs/error.log`

## FAQs

### How do I know if an address has interacted with a contract?

You can use block explorers like [Etherscan](https://etherscan.io) or [Basescan](https://basescan.org) to check for interactions. Search for the address and look for transactions involving the contract address.

### How can I test a campaign before launching?

1. Add the campaign to `contracts.json` with test dates
2. Deploy the changes to a test environment
3. Use the verification endpoints with known addresses that have interacted with the contract

### Do I need to restart the API after adding a new campaign?

No. After the PR is merged, the team would call the `/api/reload-config` endpoint to refresh the configuration.

### How does the API determine if an address has interacted?

The API checks for Transfer events and other methods to or from the specified address within the blockchain.

### What's the response format for verification?

The API returns `{"result": 1}` for successful verification (address has interacted) and `{"result": 0}` for unsuccessful verification or errors, which complies with Galxe's requirements.
