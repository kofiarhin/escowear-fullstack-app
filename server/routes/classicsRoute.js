const { Router } = require("express");
const { createClassicsController } = require("../controllers/classicsController");

const createClassicsRouter = (models = {}) => {
  const router = Router();
  const controller = createClassicsController(models);
  router.get("/", controller.getPublicClassics);
  return router;
};

module.exports = { createClassicsRouter };
