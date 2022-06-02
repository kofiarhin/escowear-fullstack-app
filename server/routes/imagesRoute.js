const { Router } = require("express");
const {
  getProductImage,
  getImage,
} = require("../controllers/imagesController");
const router = Router();

router.get("/:category/:name/:number", getProductImage);
router.get("/:filename", getImage);

module.exports = router;
