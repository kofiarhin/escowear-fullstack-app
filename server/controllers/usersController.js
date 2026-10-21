const User = require("../Models/User.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const createToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// @desc create users
// @router /api/users/register
// @access public
const createUser = async (req, res) => {
  // Only these fields are accepted; role and other privileged fields never come
  // from public input.
  const { name, email, password } = req.body || {};
  const user = new User({ name, email, password });

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

    if (!user) {
      return res.status(400).json({ error: "user not found" });
    } else {
      const auth = await bcrypt.compare(password, user.password);

      if (auth) {
        const { _id, email, name } = user;
        return res
          .status(200)
          .json({ id: _id, email, name, token: createToken(_id) });
      } else {
        return res.status(400).json({ error: "invaild email/password xxxx" });
      }
    }
  } catch (error) {
    return res.status(400).json({ error: "user not found" });
  }
};

module.exports = {
  createUser,
  loginUser,
};
