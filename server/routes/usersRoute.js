const { Router } = require("express");
const router = Router();
const { createUser, loginUser } = require("../controllers/usersController");

router.post("/register", createUser);
router.post("/login", loginUser);
module.exports = router;
