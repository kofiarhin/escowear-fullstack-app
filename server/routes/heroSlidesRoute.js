const { Router } = require("express");
const { createHeroSlidesController } = require("../controllers/heroSlidesController");

const createHeroSlidesRouter = (models = {}) => {
  const router = Router();
  const controller = createHeroSlidesController(models);
  router.get("/", controller.getPublicSlides);
  return router;
};

module.exports = { createHeroSlidesRouter };
