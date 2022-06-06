const express = require("express");
const app = express();
const mongoose = require("mongoose");
const productsRoutes = require("./routes/productsRoute");
const imagesRoute = require("./routes/imagesRoute");
const ordersRoute = require("./routes/ordersRoute");
const usersRoute = require("./routes/usersRoute");
const User = require("./Models/User.model");
const dotenv = require("dotenv").config();
const path = require("path");

// connect to database
mongoose.connect(process.env.MONGO_REMOTE, () =>
  console.log("connected to database")
);

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
    // res.sendFile(filePath);
    res.json({ message: "testing production" });
  });
}

// setup port
const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Listening on port ${port}`));
