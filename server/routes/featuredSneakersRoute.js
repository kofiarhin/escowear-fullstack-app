const { Router } = require("express");
const { createFeaturedSneakersController } = require("../controllers/featuredSneakersController");

const createFeaturedSneakersRouter = (models = {}) => {
  const router = Router();
  const controller = createFeaturedSneakersController(models);
  router.get("/", controller.getPublicFeatured);
  return router;
};

module.exports = { createFeaturedSneakersRouter };
