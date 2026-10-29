// Use the existing full instructions when supplied; otherwise derive them from
// the owner's changeable MoMo recipient settings.
const paymentInstructions = (env = process.env) => {
  const explicit = (env.ESCOWEAR_PAYMENT_INSTRUCTIONS || "").trim();
  if (explicit) return explicit;
  const number = (env.MOMO_PAYMENT_NUMBER || "").trim();
  const name = (env.MOMO_ACCOUNT_NAME || "").trim();
  if (!number || !name) return "";
  return `Mobile Money\\nNumber: ${number}\\nName: ${name}`;
};

const applyPaymentInstructions = (env = process.env) => {
  const value = paymentInstructions(env);
  if (value && !env.ESCOWEAR_PAYMENT_INSTRUCTIONS) env.ESCOWEAR_PAYMENT_INSTRUCTIONS = value;
  return value;
};

module.exports = { paymentInstructions, applyPaymentInstructions };
