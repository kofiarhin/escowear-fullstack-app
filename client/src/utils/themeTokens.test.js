// Guards the global theme contract: light is white/black with black primary
// buttons, dark is black/white with white primary buttons, and no stylesheet
// pins a section (footer, side nav, The Classics, cart summary) to one theme.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..");
const tokens = fs.readFileSync(path.join(SRC, "index.styles.css"), "utf8");

const themeBlock = (selector) => {
  const start = tokens.indexOf(`${selector} {`);
  return tokens.slice(start, tokens.indexOf("\n}", start));
};

const tokenValue = (block, name) => block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();

const cssFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith(".css") ? [full] : [];
  });

test.each([
  ['[data-theme="light"]', { surface: "#ffffff", text: "#000000", accent: "#000000", "accent-contrast": "#ffffff", "border-strong": "#000000" }],
  ['[data-theme="dark"]', { surface: "#000000", text: "#ffffff", accent: "#ffffff", "accent-contrast": "#000000", "border-strong": "#ffffff" }],
])("%s defines the required palette", (selector, expected) => {
  const block = themeBlock(selector);
  Object.entries(expected).forEach(([name, value]) => {
    expect([name, tokenValue(block, name)]).toEqual([name, value]);
  });
});

test("no stylesheet uses tokens that stay dark in both themes", () => {
  const offenders = cssFiles(SRC).filter((file) => /var\(--(inverse|nav|footer)-/.test(fs.readFileSync(file, "utf8")));
  expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
});
