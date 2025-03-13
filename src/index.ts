import express from "express";
import cors from "cors";
import verificationRoutes from "./routes/verification";
import configLoader from "./config/config-loader";
import logger from "./utils/logger";

const app = express();

// Basic middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api", verificationRoutes);

// Error handling
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    logger.error("Unhandled error:", err);
    res.json({ result: 0 }); // Always return valid Galxe response format
  }
);

// Get environment configuration
const { port } = configLoader.getEnvConfig();

// Start the server
app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
  logger.info(
    `Available contracts: ${configLoader.getAvailableContracts().join(", ")}`
  );
});
