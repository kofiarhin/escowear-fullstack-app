import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminLayout from "./AdminLayout.component";

const renderLayout = (path = "/admin") => render(
  <MemoryRouter initialEntries={[path]}>
    <AdminLayout title="Dashboard"><p>Page content</p></AdminLayout>
  </MemoryRouter>
);

afterEach(() => { document.body.style.overflow = ""; });

test.each([
  ["/admin", "Overview"],
  ["/admin/orders/123", "Orders"],
  ["/admin/products/new", "Products"],
  ["/admin/products/123/edit", "Products"],
  ["/admin/products/featured", "Featured sneakers"],
  ["/admin/hero-slides", "Hero slides"],
])("layout marks only the current section at %s", (path, label) => {
  renderLayout(path);
  const nav = screen.getByRole("navigation", { name: "Admin sections" });
  expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(1);
  expect(screen.getByRole("main")).toHaveTextContent("Page content");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "View store" })).toHaveAttribute("href", "/");
});

test("menu focuses its contents, traps Tab, locks scroll and restores focus on Escape", () => {
  document.body.style.overflow = "auto";
  renderLayout();
  const trigger = screen.getByRole("button", { name: "Menu" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute("id", trigger.getAttribute("aria-controls"));
  expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute("hidden");
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const dialog = screen.getByRole("dialog", { name: "Admin menu" });
  const close = within(dialog).getByRole("button", { name: "Close" });
  const last = within(dialog).getByRole("link", { name: "View store" });
  expect(close).toHaveFocus();
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(last).toHaveFocus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: "Escape" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(dialog).toHaveAttribute("inert");
  expect(document.body.style.overflow).toBe("auto");
  expect(trigger).toHaveFocus();
});

test("navigation closes the menu and releases the scroll lock", () => {
  renderLayout();
  fireEvent.click(screen.getByRole("button", { name: "Menu" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Products" }));
  expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
  expect(document.body.style.overflow).toBe("");
  expect(screen.getByRole("link", { name: "Products" })).toHaveAttribute("aria-current", "page");
});

test("resizing to desktop releases an open menu's scroll lock", () => {
  renderLayout();
  fireEvent.click(screen.getByRole("button", { name: "Menu" }));
  fireEvent(window, new Event("resize"));
  expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
  expect(document.body.style.overflow).toBe("");
});
