const Order = require("./server/Models/Order.model");
const User = require("./server/Models/User.model");
const Product = require("./server/Models/Product.model");
const mongoose = require("mongoose");

mongoose.connect("mongodb://localhost:27017/escowear", () =>
  console.log("connected to database")
);

const userId = "629141a20a38436ce92110e8";
const productOneId = "62847a42944ea8e6060a35c8";
const productTwoId = "62847a42944ea8e6060a35c7";
run();
async function run() {
  getOrders();
}

async function clearDB() {
  await Order.deleteMany();
  console.log("db cleared");
}

async function getOrders() {
  const orders = await Order.find().populate("products").populate("user");
  orders.forEach((order) => console.log(order));
}
// create order
async function createOrder() {
  const order = new Order({
    user: userId,
    products: [
      {
        productId: productOneId,
        size: "xl",
      },
    ],
  });

  await order.save();
  console.log("order created");
}
