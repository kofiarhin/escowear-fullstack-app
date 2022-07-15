const User = require("../Models/User.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const createToken = (id) => {
  return jwt.sign({ id }, "jwtsecret", { expiresIn: "30d" });
};

// @desc create users
// @router /api/users/register
// @access public
const createUser = async (req, res) => {
  const user = new User(req.body);

  try {
    await user.save();
    return res.status(201).json(user);
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
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password is required" });
  }

  try {
    const user = await User.findOne({ email });

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
