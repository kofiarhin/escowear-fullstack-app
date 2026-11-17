const { ORDER_STATUS: S } = require("../services/orderStatus");
const { adminSummary } = require("./adminOrdersController");
const { FEATURED_ID, MAX_FEATURED } = require("./featuredSneakersController");

// Statuses where the order is waiting on an admin step. Shared with the
// overview's "Needs attention" list so the count and the list always agree.
const ATTENTION_STATUSES = [S.PENDING_CONTACT, S.AWAITING_PAYMENT, S.PAYMENT_REVIEW, S.PAYMENT_ISSUE, S.DELIVERY_ISSUE, S.SOURCING_FAILED, S.REFUND_PENDING];
const LIST_LIMIT = 5;

// Read-only dashboard counts. Order rows reuse the admin list summary, so no
// field reaches the overview that the orders list does not already expose.
const createAdminStatsController = ({ Order, Product, HeroSlide, FeaturedSneakers, logger = console }) => {
  const getStats = async (req, res) => {
    // Legacy orders without an order number are hidden from the admin list too.
    const orders = { orderNumber: { $type: "string" } };
    const statuses = Object.values(S);
    try {
      const [total, statusCounts, productTotal, drafts, slideTotal, activeSlides, featured, recent, attention] = await Promise.all([
        Order.countDocuments(orders),
        Promise.all(statuses.map((status) => Order.countDocuments({ ...orders, status }))),
        Product.countDocuments({}),
        Product.countDocuments({ status: "draft" }),
        HeroSlide.countDocuments({}),
        HeroSlide.countDocuments({ isActive: true }),
        FeaturedSneakers.findById(FEATURED_ID).lean(),
        Order.find(orders).sort({ createdAt: -1 }).limit(LIST_LIMIT).lean(),
        Order.find({ ...orders, status: { $in: ATTENTION_STATUSES } }).sort({ createdAt: -1 }).limit(LIST_LIMIT).lean(),
      ]);
      res.set("Cache-Control", "no-store");
      return res.json({
        orders: { total, byStatus: Object.fromEntries(statuses.map((status, index) => [status, statusCounts[index]])), attentionStatuses: ATTENTION_STATUSES },
        products: { total: productTotal, published: productTotal - drafts, draft: drafts },
        heroSlides: { total: slideTotal, active: activeSlides },
        featured: { count: Math.min(featured?.productIds?.length || 0, MAX_FEATURED), max: MAX_FEATURED },
        recentOrders: recent.map(adminSummary),
        attentionOrders: attention.map(adminSummary),
      });
    } catch (error) {
      logger.error(`Admin stats failed: ${error.message}`);
      return res.status(500).json({ error: "Dashboard figures could not be loaded", code: "SERVER_ERROR" });
    }
  };

  return { getStats };
};

module.exports = { ATTENTION_STATUSES, createAdminStatsController };
