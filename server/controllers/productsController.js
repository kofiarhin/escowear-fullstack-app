const Product = require("../Models/Product.model");
const getProducts = async (req, res) => {
  const products = await Product.find();
  res.status(200).json(products);
};

const getProduct = async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id });

  if (!product) {
    return res.status(400).json({ error: "Product not found" });
  }
  res.status(200).json(product);
};
module.exports = {
  getProducts,
  getProduct,
};
