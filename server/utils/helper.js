const Product = require("../Models/Product.model");
const data = require("../data.json");

const runDatabase = async () => {
  const fields = Object.keys(data);

  let flattened = [];

  const products = await Product.find();

  fields.forEach((field) => {
    data[field].forEach((item) => flattened.push({ ...item, category: field }));
  });

  flattened.forEach(async (item) => {
    const product = new Product(item);
    await product.save();
  });
};

const clearDB = () => {
  console.log("clear db");
};
const setUpDatabase = async (connect) => {
  const products = await Product.find();
  if (products.length > 0) {
    console.log(products);
    return;
  }
  runDatabase();
};

module.exports = {
  setUpDatabase,
  runDatabase,
};
