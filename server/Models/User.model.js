const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
    },
    email: {
      type: String,
      lowercase: true,
      required: [true, "email is required"],
      unique: true,
    },
    password: {
      type: String,
      required: [true, "password is required"],
    },
    // Only a SHA-256 digest is retained, so a database read cannot be used to
    // reset an account. These fields are hidden from normal queries.
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    // Only the operator CLI (server/scripts/setUserRole.js) grants "admin";
    // registration never accepts this field.
    role: {
      type: String,
      enum: ["customer", "admin"],
      default: "customer",
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre("save", async function (next) {
  const user = this;
  // Re-saving a user must not hash the existing hash again.
  if (!user.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(user.password, salt);
  user.password = hashedPassword;
  next();
});
const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;
