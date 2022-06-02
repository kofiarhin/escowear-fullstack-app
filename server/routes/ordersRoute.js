const { Router } = require("express");
const router = Router();
const { getOrders, createOrder } = require("../controllers/ordersController");
const auth = require("../middlewares/auth.middleware");
const Order = require("../Models/Order.model");

router.get("/", auth, getOrders);
router.post("/", auth, createOrder);
module.exports = router;
