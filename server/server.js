const express = require("express");
const app = express();
const mongoose = require("mongoose");
const { connectDB } = require("./db/db");
const productsRoutes = require("./routes/productsRoute");
const imagesRoute = require("./routes/imagesRoute");
const ordersRoute = require("./routes/ordersRoute");
const usersRoute = require("./routes/usersRoute");
require("dotenv").config();
const path = require("path");

// Health includes database readiness, not just whether Express is listening.
app.get("/health", (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "unavailable" });
});

// setup middlewares
app.use(express.json());
app.use("/api/products", productsRoutes);
app.use("/api/orders", ordersRoute);
app.use("/images", imagesRoute);
app.use("/api/users", usersRoute);

// production setup
if (process.env.NODE_ENV === "production") {
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
}

// setup port
const port = process.env.PORT || 5000;

const startServer = async () => {
  if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
    throw new Error("Missing required environment variable JWT_SECRET");
  }
  await connectDB();
  return app.listen(port, () => console.log(`Listening on port ${port}`));
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Server startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };
