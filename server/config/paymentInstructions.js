// Payment instructions come from ESCOWEAR_PAYMENT_INSTRUCTIONS when supplied;
// otherwise they are derived from the owner's MoMo recipient settings, so the
// recipient can change with an .env edit alone. Values use a literal "\n"
// between lines (the .env convention); readers decode it for display.
const MOMO_SETTINGS = ["MOMO_PAYMENT_NUMBER", "MOMO_ACCOUNT_NAME"];

// One line per setting: a newline inside a value must not forge extra lines.
const oneLine = (value) => String(value || "").replace(/\\n|[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

const paymentInstructions = (env = process.env) => {
  const explicit = (env.ESCOWEAR_PAYMENT_INSTRUCTIONS || "").trim();
  if (explicit) return explicit;
  const [number, name] = MOMO_SETTINGS.map((key) => oneLine(env[key]));
  if (!number || !name) return "";
  const network = oneLine(env.MOMO_NETWORK) || "Mobile Money";
  return `${network}\\nNumber: ${number}\\nName: ${name}`;
};

// The text shown to customers and in emails, with real line breaks.
const paymentInstructionsText = (env = process.env) => paymentInstructions(env).replace(/\\n/g, "\n").trim();

// Names (never values) of a half-finished or ambiguous MoMo configuration.
const paymentSettingsProblems = (env = process.env) => {
  const set = MOMO_SETTINGS.filter((key) => oneLine(env[key]));
  if (!set.length) return [];
  if ((env.ESCOWEAR_PAYMENT_INSTRUCTIONS || "").trim()) {
    return [`ESCOWEAR_PAYMENT_INSTRUCTIONS overrides ${set.join(" and ")}; set one or the other, not both`];
  }
  const missing = MOMO_SETTINGS.filter((key) => !set.includes(key));
  return missing.length ? [`${missing.join(" and ")} is missing (both MOMO_PAYMENT_NUMBER and MOMO_ACCOUNT_NAME are required)`] : [];
};

module.exports = { paymentInstructions, paymentInstructionsText, paymentSettingsProblems };
