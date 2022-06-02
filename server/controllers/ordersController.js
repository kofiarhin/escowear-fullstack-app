const Order = require("../Models/Order.model");

const getOrders = async (req, res) => {
  const orders = await Order.find({ user: req.user._id });
  res.status(200).json(orders);
};

const createOrder = async (req, res) => {
  const order = new Order({
    user: req.user._id,
    products: req.body,
  });

  try {
    await order.save();
    return res.status(201).json({ message: "order created" });
  } catch (error) {
    return res
      .status(400)
      .json({ error: "There was a problem creating order" });
  }
};
module.exports = {
  getOrders,
  createOrder,
};
