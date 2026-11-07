const test = require("node:test");
const assert = require("node:assert/strict");
const { POPULAR_COLORS, normalizeColors } = require("../services/productColors");
const { validateProductInput } = require("../validators/adminProductValidator");

test("popular colours are shared with the client and colour input is case-insensitively deduplicated", () => {
  assert.deepEqual(POPULAR_COLORS, ["Black", "White", "Grey", "Red", "Blue", "Green", "Yellow", "Orange", "Pink", "Purple", "Brown", "Beige", "Cream", "Gold", "Silver", "Navy"]);
  assert.deepEqual(normalizeColors(["black", "WHITE", "Seafoam", "seafoam"]), ["Black", "White", "Seafoam"]);
});

test("product validation safely accepts custom colours and removes duplicates", () => {
  const accepted = validateProductInput({ colors: ["Black", "White", "Seafoam"] }, { partial: true });
  assert.deepEqual(accepted.values.colors, ["Black", "White", "Seafoam"]);
  const deduplicated = validateProductInput({ colors: ["Black", "black"] }, { partial: true });
  assert.deepEqual(deduplicated.values.colors, ["Black"]);
});
