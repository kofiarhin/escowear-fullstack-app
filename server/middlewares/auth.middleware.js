const jwt = require("jsonwebtoken");
const User = require("../Models/User.model");
const auth = (req, res, next) => {
  let token = "";
  try {
    token = req.headers.authorization;
    token = token.split(" ")[1];

    jwt.verify(token, "jwtsecret", async (error, payload) => {
      if (error) {
        return res.status(401).json({ error: "Unauthorized - invalid token" });
      } else {
        //   get user from database
        const user = await User.findOne({ _id: payload.id });
        if (!user) {
          return res
            .status(404)
            .json({ error: "authorization - user not found" });
        } else {
          // set user and move to next resource
          req.user = user;
          next();
        }
      }
    });
  } catch (error) {
    return res.status(401).json({ error: "Unauthorized - no token" });
  }
};

module.exports = auth;
