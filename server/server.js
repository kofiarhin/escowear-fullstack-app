const express = require("express");
const app = express();
const mongoose = require("mongoose");
const productsRoutes = require("./routes/productsRoute");
const imagesRoute = require("./routes/imagesRoute");
const ordersRoute = require("./routes/ordersRoute");
const usersRoute = require("./routes/usersRoute");
const User = require("./Models/User.model");

// connect to database
mongoose.connect("mongodb://localhost:27017/escowear", () =>
  console.log("connected to database")
);

const clearDb = async () => {
  await User.deleteMany();

  console.log("db cleared");
};

// clearDb();

// setup middlewares
app.use(express.json());
app.use("/api/products", productsRoutes);
app.use("/api/orders", ordersRoute);
app.use("/images", imagesRoute);
app.use("/api/users", usersRoute);

// setup port
const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Listening on port ${port}`));
