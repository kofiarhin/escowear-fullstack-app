const { parsePage } = require("../services/orderService");
const { isObjectId } = require("../validators/orderValidator");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Only these fields leave the server; password hashes, reset tokens and
// session versions never do.
const adminUserSummary = (user) => ({
  id: String(user._id),
  email: user.email,
  name: user.name || "",
  role: user.role || "customer",
  createdAt: user.createdAt,
  blocked: Boolean(user.blocked),
  blockedAt: user.blockedAt || null,
});

// Admins may view every account but only block or delete customer accounts
// other than their own, so the console can never lock out an administrator.
const createAdminUsersController = ({ User, logger = console }) => {
  const fail = (res, status, code, error) => res.status(status).json({ error, code });

  const handle = (label, message, fn) => async (req, res) => {
    try {
      return await fn(req, res);
    } catch (error) {
      logger.error(`Admin users ${label} failed: ${error.message}`);
      return fail(res, 500, "SERVER_ERROR", message);
    }
  };

  // Returns the customer account an admin may act on, or the refusal to send.
  const findTarget = async (req) => {
    if (!isObjectId(req.params.id)) return { refusal: [404, "NOT_FOUND", "User not found"] };
    const user = await User.findOne({ _id: req.params.id }).lean();
    if (!user) return { refusal: [404, "NOT_FOUND", "User not found"] };
    if (String(user._id) === String(req.user._id)) return { refusal: [409, "SELF_ACTION", "You cannot block or delete your own account"] };
    if (user.role === "admin") return { refusal: [409, "ADMIN_ACCOUNT", "Admin accounts cannot be blocked or deleted"] };
    return { user };
  };

  const listUsers = handle("list", "Users could not be loaded", async (req, res) => {
    const { page, limit, skip } = parsePage(req.query);
    const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase().slice(0, 254) : "";
    // Emails are stored lowercase, so a case-insensitive regex is not needed.
    const filter = q ? { email: { $regex: escapeRegex(q) } } : {};
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    res.set("Cache-Control", "no-store");
    return res.json({ items: users.map(adminUserSummary), pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  });

  const setBlocked = handle("block", "User could not be updated", async (req, res) => {
    const blocked = req.body?.blocked;
    if (typeof blocked !== "boolean") return fail(res, 400, "VALIDATION_ERROR", "blocked must be true or false");
    const { user, refusal } = await findTarget(req);
    if (refusal) return fail(res, ...refusal);
    // Blocking also bumps the session version, so tokens issued before the
    // block stay revoked even after the account is unblocked.
    const update = blocked
      ? { $set: { blocked: true, blockedAt: new Date() }, $inc: { sessionVersion: 1 } }
      : { $set: { blocked: false }, $unset: { blockedAt: "" } };
    // The role guard is repeated in the write so a concurrent promotion to
    // admin cannot slip between the check and the update.
    const updated = await User.findOneAndUpdate({ _id: user._id, role: { $ne: "admin" } }, update, { new: true }).lean();
    if (!updated) return fail(res, 404, "NOT_FOUND", "User not found");
    res.set("Cache-Control", "no-store");
    return res.json({ item: adminUserSummary(updated) });
  });

  // Orders keep their own customer snapshot, so they remain intact for the
  // business record after the account is removed.
  const deleteUser = handle("delete", "User could not be deleted", async (req, res) => {
    const { user, refusal } = await findTarget(req);
    if (refusal) return fail(res, ...refusal);
    const result = await User.deleteOne({ _id: user._id, role: { $ne: "admin" } });
    if (!result.deletedCount) return fail(res, 404, "NOT_FOUND", "User not found");
    return res.status(204).end();
  });

  return { listUsers, setBlocked, deleteUser };
};

module.exports = { adminUserSummary, createAdminUsersController };
