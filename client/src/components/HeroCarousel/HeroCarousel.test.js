import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HeroCarousel from "./HeroCarousel.component";

const slides = [
  { id: "slide-1", productId: "product-1", productName: "First pair", productInStock: true, headline: "FIRST PAIR", description: "First description", desktopImage: "/images/first.jpg", mobileImage: "/images/first-mobile.jpg", order: 0 },
  { id: "slide-2", productId: "product-2", productName: "Second pair", productInStock: false, headline: "SECOND PAIR", description: "Second description", desktopImage: "/images/second.jpg", mobileImage: "/images/second-mobile.jpg", order: 1 },
];

const renderCarousel = () => render(<MemoryRouter><HeroCarousel /></MemoryRouter>);

beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ items: slides }) });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("loads slide content from the public endpoint and keeps only the active slide accessible", async () => {
  renderCarousel();
  expect(screen.getByLabelText(/loading homepage feature/i)).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "FIRST PAIR" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Shop Now" })).toHaveAttribute("href", "/details/product-1");
  expect(screen.queryByRole("heading", { name: "SECOND PAIR" })).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith("/api/hero-slides", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test("supports manual navigation, pause and six-second autoplay", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "FIRST PAIR" });
  fireEvent.click(screen.getByRole("button", { name: /next slide/i }));
  expect(screen.getByRole("heading", { name: "SECOND PAIR" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /pause carousel/i }));
  act(() => jest.advanceTimersByTime(6100));
  expect(screen.getByRole("heading", { name: "SECOND PAIR" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /play carousel/i }));
  act(() => jest.advanceTimersByTime(6100));
  expect(screen.getByRole("heading", { name: "FIRST PAIR" })).toBeInTheDocument();
});

test("renders a usable static fallback for empty and failed responses", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) });
  renderCarousel();
  expect(await screen.findByRole("heading", { name: /authentic uk sneakers/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Shop Now" })).toHaveAttribute("href", "/store");
});
