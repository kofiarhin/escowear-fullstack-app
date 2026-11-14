import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { applyMiddleware, createStore } from "redux";
import thunk from "redux-thunk";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import reducers from "../../redux/reducers";
import Store from "./store.page";

const jsonResponse = (items = []) => Promise.resolve({
  ok: true,
  json: async () => ({ items, pagination: { total: items.length, page: 1, limit: 24, pages: 1 } }),
});

const LocationControls = () => {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{location.search}</output>
      <button type="button" onClick={() => navigate("/store?search=adidas&page=2")}>Visit Adidas search</button>
      <button type="button" onClick={() => navigate(-1)}>Go back</button>
    </>
  );
};

const renderStore = (initial = "/store") => {
  const store = createStore(reducers, applyMiddleware(thunk));
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initial]}>
        <LocationControls />
        <Routes><Route path="/store" element={<Store />} /></Routes>
      </MemoryRouter>
    </Provider>
  );
};

beforeEach(() => {
  global.fetch = jest.fn(() => jsonResponse());
});
afterEach(() => {
  jest.restoreAllMocks();
});

test("submitting a trimmed search requests matching products on page one", async () => {
  renderStore("/store?page=3");
  await userEvent.type(screen.getByRole("searchbox", { name: "Search sneakers" }), "  nike  ");
  await userEvent.click(screen.getByRole("button", { name: "Search" }));

  expect(screen.getByTestId("location")).toHaveTextContent("search=nike&page=1");
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("search=nike")));
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("page=1"));
});

test("clearing search restores the full catalogue on page one", async () => {
  renderStore("/store?search=nike&page=3");
  expect(screen.getByRole("searchbox", { name: "Search sneakers" })).toHaveValue("nike");
  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.getByRole("searchbox", { name: "Search sneakers" })).toHaveValue("");
  expect(screen.getByTestId("location")).toHaveTextContent("?page=1");
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/products?limit=24&page=1"));
});

test("browser navigation refreshes the search input without typing", async () => {
  renderStore("/store?search=nike");
  expect(screen.getByRole("searchbox", { name: "Search sneakers" })).toHaveValue("nike");
  await userEvent.click(screen.getByRole("button", { name: "Visit Adidas search" }));
  expect(screen.getByRole("searchbox", { name: "Search sneakers" })).toHaveValue("adidas");
  await userEvent.click(screen.getByRole("button", { name: "Go back" }));
  expect(screen.getByRole("searchbox", { name: "Search sneakers" })).toHaveValue("nike");
});

test("empty submitted query clears legacy filters and resets pagination", async () => {
  renderStore("/store?search=nike&category=shoes&page=8");
  const input = screen.getByRole("searchbox", { name: "Search sneakers" });
  await userEvent.clear(input);
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(screen.getByTestId("location")).toHaveTextContent("?page=1");
});
