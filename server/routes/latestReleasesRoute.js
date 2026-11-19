const { Router } = require("express");
const { createLatestReleasesController } = require("../controllers/latestReleasesController");

const createLatestReleasesRouter = (models = {}) => {
  const router = Router();
  const controller = createLatestReleasesController(models);
  router.get("/", controller.getPublicLatestReleases);
  return router;
};

module.exports = { createLatestReleasesRouter };
