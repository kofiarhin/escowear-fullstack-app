import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HeroCarousel from "./HeroCarousel.component";

const imageSlides = [
  { id: "slide-1", productId: "product-1", productName: "First pair", productInStock: true, headline: "FIRST PAIR", description: "First description", desktopImage: "/images/first.jpg", mobileImage: "/images/first-mobile.jpg", desktopVideo: "", mobileVideo: "", posterImage: "", order: 0 },
  { id: "slide-2", productId: "product-2", productName: "Second pair", productInStock: false, headline: "SECOND PAIR", description: "Second description", desktopImage: "/images/second.jpg", mobileImage: "/images/second-mobile.jpg", desktopVideo: "", mobileVideo: "", posterImage: "", order: 1 },
];

const videoSlide = {
  id: "slide-v1", productId: "product-v1", productName: "Video pair", productInStock: true,
  headline: "VIDEO SLIDE", description: "A video slide", desktopImage: "",
  mobileImage: "", desktopVideo: "https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-1_kcv6pl.mp4",
  mobileVideo: "", posterImage: "https://res.cloudinary.com/dlsiabgiw/video/upload/so_0/hero-video-1_kcv6pl.jpg", order: 0,
};

const videoSlide2 = {
  id: "slide-v2", productId: "product-v2", productName: "Video pair 2", productInStock: true,
  headline: "SECOND VIDEO", description: "Another video slide", desktopImage: "",
  mobileImage: "", desktopVideo: "https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-2_nr2029.mp4",
  mobileVideo: "", posterImage: "", order: 1,
};

const mockPlay = jest.fn().mockResolvedValue(undefined);
const mockPause = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [videoSlide, videoSlide2] }) });
  Object.defineProperty(HTMLVideoElement.prototype, "play", { configurable: true, writable: true, value: mockPlay });
  Object.defineProperty(HTMLVideoElement.prototype, "pause", { configurable: true, writable: true, value: mockPause });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  mockPlay.mockClear();
  mockPause.mockClear();
  delete HTMLVideoElement.prototype.play;
  delete HTMLVideoElement.prototype.pause;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

const renderCarousel = () => render(<MemoryRouter><HeroCarousel /></MemoryRouter>);
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

// --- Video-only carousel tests ---

test("loads video slides from the API and renders the first one", async () => {
  renderCarousel();
  expect(screen.getByLabelText(/loading homepage feature/i)).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Shop Now" })).toHaveAttribute("href", "/details/product-v1");
  expect(screen.queryByRole("heading", { name: "SECOND VIDEO" })).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith("/api/hero-slides", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

test("supports manual navigation and pause between two video slides", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  fireEvent.click(screen.getByRole("button", { name: /next slide/i }));
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /shop now/i })).toHaveAttribute("href", "/details/product-v2");
  fireEvent.click(screen.getByRole("button", { name: /pause carousel/i }));
  const video2 = screen.getByTestId("hero-video-slide-v2");
  act(() => { video2.dispatchEvent(new Event("ended")); });
  // Paused: should not advance
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /play carousel/i }));
});

test("filters out image-only slides and shows only video slides from the API", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [imageSlides[0], videoSlide, imageSlides[1], videoSlide2] }) });
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  // Only video slides are shown — image slides are hidden
  fireEvent.click(screen.getByRole("button", { name: /next slide/i }));
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
  // No further slides (only 2 video slides)
  fireEvent.click(screen.getByRole("button", { name: /next slide/i }));
  expect(screen.getByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();
});

test("falls back to default video slides when API returns only image slides", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: imageSlides }) });
  renderCarousel();
  expect(await screen.findByRole("heading", { name: "STEP INTO STYLE" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Shop Now" })).toHaveAttribute("href", "/store");
});

test("falls back to default video slides when API returns empty response", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) });
  renderCarousel();
  expect(await screen.findByRole("heading", { name: "STEP INTO STYLE" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Shop Now" })).toHaveAttribute("href", "/store");
});

test("falls back to default video slides when API fails", async () => {
  global.fetch.mockResolvedValueOnce({ ok: false });
  renderCarousel();
  expect(await screen.findByRole("heading", { name: "STEP INTO STYLE" })).toBeInTheDocument();
});

test("default video slides link to /store and show branded eyebrow", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) });
  renderCarousel();
  await screen.findByRole("heading", { name: "STEP INTO STYLE" });
  expect(screen.getByText("Escowear / UK to Ghana")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Shop Now" })).toHaveAttribute("href", "/store");
});

test("video slide renders a <video> element with muted and playsInline attributes", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  const video = screen.getByTestId("hero-video-slide-v1");
  expect(video).toBeInTheDocument();
  expect(video).toHaveAttribute("playsinline", "");
  expect(video.muted).toBe(true);
});

test("video slide uses poster attribute on the video element", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [videoSlide] }) });
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  const video = screen.getByTestId("hero-video-slide-v1");
  expect(video).toHaveAttribute("poster", videoSlide.posterImage);
});

test("video slide with no desktopImage but valid poster is accepted", async () => {
  const videoOnly = { ...videoSlide, desktopImage: "" };
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [videoOnly] }) });
  renderCarousel();
  expect(await screen.findByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();
});

test("navigates correctly between two video slides", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  expect(screen.getByTestId("hero-video-slide-v1")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /next slide/i }));
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /previous slide/i }));
  expect(screen.getByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();
});

test("video slide advances on ended event exactly once", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });

  const video = screen.getByTestId("hero-video-slide-v1");
  act(() => { video.dispatchEvent(new Event("ended")); });
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();

  // Second ended on the same video should not double-advance
  act(() => { video.dispatchEvent(new Event("ended")); });
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
});

test("stalled video without timeupdate triggers fallback advance after timeout", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });

  // No timeupdate = stall. Wait for stall timeout (15s).
  act(() => jest.advanceTimersByTime(15_000));
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
});

test("healthy video playback beyond 15 seconds is not interrupted", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });

  const video = screen.getByTestId("hero-video-slide-v1");
  // Simulate ongoing playback with timeupdate events that reset the stall watchdog
  act(() => jest.advanceTimersByTime(10_000));
  act(() => { video.dispatchEvent(new Event("timeupdate")); });
  act(() => jest.advanceTimersByTime(10_000));
  act(() => { video.dispatchEvent(new Event("timeupdate")); });
  // Still on the video slide after 20s of healthy playback
  expect(screen.getByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();
});

test("pause button pauses video and resume plays from same position", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  await settle();

  mockPause.mockClear();
  mockPlay.mockClear();
  fireEvent.click(screen.getByRole("button", { name: /pause carousel/i }));
  await settle();
  expect(mockPause).toHaveBeenCalled();

  mockPlay.mockClear();
  fireEvent.click(screen.getByRole("button", { name: /play carousel/i }));
  await settle();
  expect(mockPlay).toHaveBeenCalled();
});

test("hover does not pause video or slide progression", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });

  const section = screen.getByTestId("hero-carousel");
  fireEvent.mouseEnter(section);

  const video = screen.getByTestId("hero-video-slide-v1");
  act(() => { video.dispatchEvent(new Event("ended")); });
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
});

test("hidden document stops video autoplay and does not advance", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  await settle();

  mockPause.mockClear();
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await settle();
  expect(mockPause).toHaveBeenCalled();

  // Stall timer should not fire while hidden
  act(() => jest.advanceTimersByTime(20_000));
  expect(screen.getByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();

  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
});

test("autoplay rejection shows manual play button and preserves poster", async () => {
  mockPlay.mockRejectedValue(new DOMException("not allowed", "NotAllowedError"));
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [videoSlide, videoSlide2] }) });
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  await settle();

  expect(screen.getByRole("button", { name: /play video/i })).toBeInTheDocument();
  // Poster is preserved via the video element's poster attribute
  const video = screen.getByTestId("hero-video-slide-v1");
  expect(video).toHaveAttribute("poster", videoSlide.posterImage);

  // Clicking manual play clears the blocked state
  mockPlay.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: /play video/i }));
  await settle();
  expect(screen.queryByRole("button", { name: /play video/i })).not.toBeInTheDocument();
});

test("single video slide loops instead of advancing", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [videoSlide] }) });
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  await settle();

  const video = screen.getByTestId("hero-video-slide-v1");
  expect(video.loop).toBe(true);
  expect(screen.queryByRole("button", { name: /next slide/i })).not.toBeInTheDocument();
});

test("video error advances to next slide", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  await settle();

  const video = screen.getByTestId("hero-video-slide-v1");
  act(() => { video.dispatchEvent(new Event("error")); });
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
});
