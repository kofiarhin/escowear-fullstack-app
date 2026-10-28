import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Policies from "./Policies.page";
import Footer from "../../components/Footer/Footer.component";
import { POLICY_VERSION } from "../../policies/content";
import { POLICY_SECTIONS } from "../../policies/sections";

const renderWith = (status, ui = <Policies />) => {
  if (status === undefined) delete process.env.REACT_APP_POLICIES_STATUS;
  else process.env.REACT_APP_POLICIES_STATUS = status;
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

afterEach(() => {
  delete process.env.REACT_APP_POLICIES_STATUS;
});

test("hidden by default: no policy text, no footer link", () => {
  renderWith(undefined);
  expect(screen.getByText(/being finalised/i)).toBeInTheDocument();
  expect(screen.queryByText(/14 days of receiving it/i)).not.toBeInTheDocument();
  expect(screen.queryByText(POLICY_VERSION, { exact: false })).not.toBeInTheDocument();
});

test("unknown values fall back to hidden", () => {
  renderWith("yes-please");
  expect(screen.getByText(/being finalised/i)).toBeInTheDocument();
});

test("draft shows every section with a DRAFT banner for review", () => {
  renderWith("draft");
  expect(screen.getByRole("note")).toHaveTextContent(/draft — not yet published/i);
  POLICY_SECTIONS.forEach((section) => expect(screen.getByRole("heading", { name: section.title })).toBeInTheDocument());
  expect(screen.getByText(/includes everything: the shoes, shipping, import duties, taxes and delivery/i)).toBeInTheDocument();
  expect(screen.getByText(/valid for 48 hours/i)).toBeInTheDocument();
  expect(screen.getByText(/We accept Mobile Money only/i)).toBeInTheDocument();
  expect(screen.getByText("Delivery is confirmed individually after ordering.")).toBeInTheDocument();
  expect(screen.queryByText(/10–21 days/)).not.toBeInTheDocument();
  expect(screen.getByText("We serve customers in Ghana.")).toBeInTheDocument();
  expect(screen.getByText("Payment method: Manual Mobile Money confirmation.")).toBeInTheDocument();
  expect(screen.getByText(/full refund to the Mobile Money number you paid from within 7 days/i)).toBeInTheDocument();
  expect(screen.getByText(/within 14 days of receiving it, without giving a reason/i)).toBeInTheDocument();
  expect(screen.getByText(/EscoWear pays the cost of returning the item/i)).toBeInTheDocument();
  expect(screen.getByText(/order and payment records for 6 years/i)).toBeInTheDocument();
  expect(screen.getByText("Business name: EscoWear.")).toBeInTheDocument();
  expect(screen.getByText("Business address: To be confirmed.")).toBeInTheDocument();
  expect(screen.getByText(/Support email: support@escowear.com — UNVERIFIED; mailbox testing is pending/i)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /support@escowear.com/ })).not.toBeInTheDocument();
  const toc = screen.getByRole("navigation", { name: /policy sections/i });
  expect(within(toc).getAllByRole("link")).toHaveLength(POLICY_SECTIONS.length);
});

test("published shows the text without the draft banner; footer links to it", () => {
  renderWith("published");
  expect(screen.queryByRole("note")).not.toBeInTheDocument();
  expect(screen.getByText(`Policy version ${POLICY_VERSION}`)).toBeInTheDocument();
  renderWith("published", <Footer />);
  expect(screen.getByRole("link", { name: "Shop policies" })).toHaveAttribute("href", "/policies");
});

test("footer has no policy link while hidden", () => {
  renderWith("hidden", <Footer />);
  expect(screen.queryByRole("link", { name: "Shop policies" })).not.toBeInTheDocument();
});
