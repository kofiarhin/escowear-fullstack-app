const express = require("express");
const mongoose = require("mongoose");
const { connectDB } = require("./db/db");
const productsRoutes = require("./routes/productsRoute");
const imagesRoute = require("./routes/imagesRoute");
const { createOrdersRouter } = require("./routes/ordersRoute");
const usersRoute = require("./routes/usersRoute");
const { createAdminRouter } = require("./routes/adminRoute");
require("dotenv").config();
const path = require("path");

// `deps` lets tests inject in-memory models; production uses the defaults.
const createApp = (deps = {}) => {
  const app = express();
  // Beast serves the app behind a local Nginx proxy; trust only loopback hops
  // so rate limits key on the real client address.
  app.set("trust proxy", "loopback");

  // Health includes database readiness, not just whether Express is listening.
  app.get("/health", (req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "unavailable" });
  });

  // setup middlewares
  app.use(express.json({ limit: "32kb" }));
  app.use("/api/products", deps.products ? productsRoutes.createProductsRouter(deps.products.Product) : productsRoutes);
  app.use("/api/orders", createOrdersRouter(deps.orders));
  app.use("/images", imagesRoute);
  app.use("/api/users", usersRoute);
  app.use("/api/admin", createAdminRouter(deps.admin));

  // Malformed JSON and oversized bodies get a JSON error rather than an HTML page.
  app.use((error, req, res, next) => {
    if (error?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body", code: "INVALID_JSON" });
    if (error?.type === "entity.too.large") return res.status(413).json({ error: "Request body too large", code: "BODY_TOO_LARGE" });
    return next(error);
  });

  if (process.env.NODE_ENV === "production") mountClient(app);
  return app;
};

// production setup
const mountClient = (app) => {
  app.use(express.static(path.join(__dirname, "../client/build")));
  app.get("*", (req, res) => {
    const filePath = path.resolve(
      __dirname,
      "../",
      "client",
      "build",
      "index.html"
    );
    res.sendFile(filePath);
  });
};

const app = createApp();

// Starts the outbox worker only when a transport is configured. With the
// default EMAIL_TRANSPORT=none, emails stay queued and visible to admins.
const startEmailDelivery = () => {
  const { createTransportFromEnv } = require("./emails/transports");
  const transport = createTransportFromEnv();
  if (!transport) {
    console.log("Email transport: none (messages stay queued)");
    return null;
  }
  const { startEmailWorker } = require("./services/emailWorker");
  const { createOrderService } = require("./services/orderService");
  const { getOrderConfig } = require("./config/orders");
  const models = {
    Order: require("./Models/Order.model"),
    OrderEvent: require("./Models/OrderEvent.model"),
    EmailOutbox: require("./Models/EmailOutbox.model"),
    Product: require("./Models/Product.model"),
  };
  const config = getOrderConfig();
  const orderService = createOrderService({ ...models, config });
  console.log(`Email transport: ${transport.name}`);
  return startEmailWorker({ ...models, orderService, transport, trackingCodeTtlMinutes: config.trackingCodeTtlMinutes });
};

// setup port
const port = process.env.PORT || 5000;

const startServer = async () => {
  if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
    throw new Error("Missing required environment variable JWT_SECRET");
  }
  await connectDB();
  startEmailDelivery();
  return app.listen(port, () => console.log(`Listening on port ${port}`));
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Server startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { app, createApp, startServer };
