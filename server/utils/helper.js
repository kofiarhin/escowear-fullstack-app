const Product = require("../Models/Product.model");
const data = require("../data.json");

const dataTransform = () => {
  const fields = Object.keys(data);

  let flattened = [];

  fields.forEach((field) => {
    data[field].forEach((item) => flattened.push({ ...item, category: field }));
  });

  flattened.forEach(async (item) => {
    const product = new Product(item);
    await product.save();
  });
};

const setUpDatabase = async () => {
  const products = await Product.find();
  console.log(products);
};

module.exports = {
  setUpDatabase,
};
