import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "api",
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Message Brokers API",
    version: "0.0.1",
    endpoints: {
      health: "GET /health",
    },
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`RABBITMQ_URL: ${process.env.RABBITMQ_URL}`);
  console.log(`MONGODB_URI: ${process.env.MONGODB_URI}`);
});
