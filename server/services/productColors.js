const POPULAR_COLORS = require("../../client/src/constants/productColors.json");

const cleanColor = (value) => {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
};

const titleCase = (value) => value.toLocaleLowerCase("en").replace(/(^|[\s-])([a-z])/g, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);

const normalizeColor = (value) => {
  const cleaned = cleanColor(value);
  if (!cleaned || cleaned.length > 80 || CONTROL.test(cleaned) || /[<>]/.test(cleaned)) return "";
  const parts = cleaned.split("/").map((part) => part.trim());
  if (parts.some((part) => !part)) return "";
  const color = parts.map(titleCase).join(" / ");
  const popular = POPULAR_COLORS.find((option) => option.toLocaleLowerCase("en") === color.toLocaleLowerCase("en"));
  return popular || color;
};

const colorKey = (value) => normalizeColor(value).toLocaleLowerCase("en");

const CONTROL = /[\u0000-\u001f\u007f]/;

const normalizeColors = (values = []) => {
  const seen = new Set();
  const colors = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const color = normalizeColor(value);
    if (!color) continue;
    const key = colorKey(color);
    if (seen.has(key)) continue;
    seen.add(key);
    colors.push(color);
  }
  return colors;
};

module.exports = { POPULAR_COLORS, colorKey, normalizeColor, normalizeColors };
