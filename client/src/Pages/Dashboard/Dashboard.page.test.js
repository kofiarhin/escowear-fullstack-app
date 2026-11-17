import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import DashBoard from "./Dashboard.page";

test("the old /dashboard URL redirects to /account", () => {
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/dashboard" element={<DashBoard />} />
        <Route path="/account" element={<p>Account page</p>} />
      </Routes>
    </MemoryRouter>
  );
  expect(screen.getByText("Account page")).toBeInTheDocument();
});
