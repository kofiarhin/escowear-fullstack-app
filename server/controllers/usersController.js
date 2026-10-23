const User = require("../Models/User.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ADMIN_SESSION_SECONDS } = require("../middlewares/auth.middleware");

// Admins get short sessions; customers keep the existing 30-day sign-in.
const createToken = (id, role) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: role === "admin" ? ADMIN_SESSION_SECONDS : "30d" });

const PASSWORD_MIN = 10;
const PASSWORD_MAX = 128;

// @desc create users
// @router /api/users/register
// @access public
const createUser = async (req, res) => {
  // Only these fields are accepted; role and other privileged fields never come
  // from public input.
  const { name, email, password } = req.body || {};
  if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string" || !name.trim() || !email.trim()) {
    return res.status(400).json({ error: "Name, email and password are required" });
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return res.status(400).json({ error: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters` });
  }
  const user = new User({ name: name.trim(), email: email.trim().toLowerCase(), password });

  try {
    await user.save();
    const responseUser = user.toObject ? user.toObject() : { ...user };
    delete responseUser.password;
    return res.status(201).json(responseUser);
  } catch (error) {
    const handleError = (error) => {
      let message = "There was a problem registering user";

      if (error.code === 11000) {
        message = "Email already in use";
      }

      return message;
    };
    return res.status(400).json({ error: handleError(error) });
  }
};

// login user
// @router /api/users/login
// @access public
const loginUser = async (req, res) => {
  const { email, password } = req.body || {};

  // Strings only: an object such as {"$gt": ""} must never reach the query.
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ error: "email and password is required" });
  }

  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });

    // One message for unknown email and wrong password, so the login form
    // cannot be used to discover which accounts (including admins) exist.
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    } else {
      const auth = await bcrypt.compare(password, user.password);

      if (auth) {
        const { _id, email, name } = user;
        // `role` only drives what the UI shows; every admin API re-checks it server-side.
        return res
          .status(200)
          .json({ id: _id, email, name, role: user.role || "customer", token: createToken(_id, user.role) });
      } else {
        return res.status(400).json({ error: "Invalid email or password" });
      }
    }
  } catch (error) {
    return res.status(400).json({ error: "Invalid email or password" });
  }
};

module.exports = {
  createUser,
  loginUser,
};
