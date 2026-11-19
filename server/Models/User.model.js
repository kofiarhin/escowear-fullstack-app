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
    // Every issued JWT carries this value. Incrementing it persistently makes
    // all prior customer and admin sessions invalid after a password reset.
    sessionVersion: { type: Number, default: 0, min: 0 },
    // Only the operator CLI (server/scripts/setUserRole.js) grants "admin";
    // registration never accepts this field.
    role: {
      type: String,
      enum: ["customer", "admin"],
      default: "customer",
    },
    // Set by an admin from /admin/users. A blocked account cannot sign in or
    // use an existing session.
    blocked: { type: Boolean, default: false },
    blockedAt: { type: Date },
    // Email verification (IDE-152). Only accounts created by /register after
    // the feature shipped carry verificationRequired; existing accounts have
    // none of these fields and are never subject to verification or cleanup.
    verificationRequired: { type: Boolean },
    emailVerifiedAt: { type: Date },
    // Fixed at registration; resends and email corrections never move it.
    verificationDeadline: { type: Date },
    // SHA-256 of the latest link token only; earlier links stop working.
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    // Customer resends/corrections in the rolling window, for the 3-per-24h limit.
    verificationEmailSends: { type: [Date], default: undefined },
    lastVerificationEmailAt: { type: Date },
    // Outbox message whose SMTP acceptance makes the account eligible for
    // automatic deletion: the first verification email to the current address.
    verificationDeliveryEmailId: { type: mongoose.Schema.Types.ObjectId },
    verificationEmailAcceptedAt: { type: Date },
    verificationLatestEmailId: { type: mongoose.Schema.Types.ObjectId },
    finalWarningQueuedAt: { type: Date },
    verificationExpiredAt: { type: Date },
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
// Lookups for verification links and the warning/expiry/cleanup job. Partial,
// so existing accounts without these fields add nothing to the indexes.
userSchema.index(
  { emailVerificationTokenHash: 1 },
  { name: "email_verification_token", partialFilterExpression: { emailVerificationTokenHash: { $type: "string" } } }
);
userSchema.index(
  { verificationDeadline: 1 },
  { name: "verification_deadline_pending", partialFilterExpression: { verificationRequired: true } }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;
