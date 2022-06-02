const path = require("path");
const getProductImage = (req, res) => {
  const { category, name, number } = req.params;
  res.sendFile(path.join(__dirname, "..", "images", category, name, number));
};
const getImage = (req, res) => {
  const { filename } = req.params;
  res.sendFile(path.join(__dirname, "..", "images", filename));
};

module.exports = {
  getProductImage,
  getImage,
};
