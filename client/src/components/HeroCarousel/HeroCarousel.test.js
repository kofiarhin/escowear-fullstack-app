import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HeroCarousel from "./HeroCarousel.component";
import { heroVideoPosterUrl, optimiseHeroVideoUrl, resolveHeroVideo } from "./heroMedia";

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
  mockPlay.mockReset().mockResolvedValue(undefined);
  mockPause.mockClear();
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
  delete window.matchMedia;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

const renderCarousel = () => render(<MemoryRouter><HeroCarousel /></MemoryRouter>);
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

const mockMatchMedia = (matchingQueries) => {
  window.matchMedia = jest.fn((query) => ({
    matches: matchingQueries.includes(query), media: query,
    addEventListener: jest.fn(), removeEventListener: jest.fn(),
  }));
};

// Simulates playback with timeupdate events from `from` up to just before the
// clip wraps (the loop boundary where the carousel may advance).
const playToLoopBoundary = (video, { duration = 10, from = 0 } = {}) => {
  let time = from;
  Object.defineProperty(video, "duration", { configurable: true, value: duration });
  Object.defineProperty(video, "currentTime", { configurable: true, get: () => time, set: (value) => { time = value; } });
  act(() => {
    for (let step = from; step < duration - 0.5; step += 1) {
      time = step;
      video.dispatchEvent(new Event("timeupdate"));
    }
    time = duration - 0.5;
    video.dispatchEvent(new Event("timeupdate"));
  });
};
const wrapLoop = (video) => {
  act(() => {
    video.currentTime = 0.2;
    video.dispatchEvent(new Event("timeupdate"));
  });
};

// --- Carousel tests ---

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
  playToLoopBoundary(video2);
  // Paused: should not advance
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /play carousel/i }));
});

test("mixed slides keep API order: videos play and image-only slides fall back to their image", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [videoSlide, imageSlides[0]] }) });
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  const video = screen.getByTestId("hero-video-slide-v1");
  expect(video.muted).toBe(true);
  expect(video.loop).toBe(true);
  expect(video).toHaveAttribute("playsinline", "");
  // The image slide renders as a picture, never as a video element.
  expect(screen.queryByTestId("hero-video-slide-1")).not.toBeInTheDocument();
  expect(screen.getByTestId("hero-image-slide-1")).toHaveAttribute("src", "/images/first.jpg");

  fireEvent.click(screen.getByRole("button", { name: /next slide/i }));
  expect(screen.getByRole("heading", { name: "FIRST PAIR" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /shop now/i })).toHaveAttribute("href", "/details/product-1");
  fireEvent.click(screen.getByRole("button", { name: /next slide/i }));
  expect(screen.getByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();
});

test("image-only API slides (legacy live data) still render instead of the default videos", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: imageSlides }) });
  renderCarousel();
  expect(await screen.findByRole("heading", { name: "FIRST PAIR" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "STEP INTO STYLE" })).not.toBeInTheDocument();
  expect(screen.getByTestId("hero-image-slide-1")).toHaveAttribute("src", "/images/first.jpg");
  expect(screen.getByTestId("hero-image-slide-2")).toHaveAttribute("src", "/images/second.jpg");
  expect(screen.queryByTestId(/^hero-video-/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /shop now/i })).toHaveAttribute("href", "/details/product-1");
  expect(screen.getByRole("button", { name: /pause carousel/i })).toBeInTheDocument();
  // Image slides keep the 10-second rotation.
  act(() => { jest.advanceTimersByTime(10_000); });
  expect(screen.getByRole("heading", { name: "SECOND PAIR" })).toBeInTheDocument();
});

test("shows the static banner and no videos when admin has published no slides", async () => {
  global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) });
  renderCarousel();
  expect(await screen.findByRole("heading", { name: "Authentic UK sneakers. Delivered to Ghana." })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Shop Now" })).toHaveAttribute("href", "/store");
  expect(screen.queryByTestId(/^hero-video-/)).not.toBeInTheDocument();
  expect(screen.queryByTestId("hero-carousel")).not.toBeInTheDocument();
});

test("shows the static banner and no videos when the hero API fails", async () => {
  global.fetch.mockResolvedValueOnce({ ok: false });
  renderCarousel();
  expect(await screen.findByRole("heading", { name: "Authentic UK sneakers. Delivered to Ghana." })).toBeInTheDocument();
  expect(screen.queryByTestId(/^hero-video-/)).not.toBeInTheDocument();
});

test("shows the static banner and no videos when the hero API rejects", async () => {
  global.fetch.mockRejectedValueOnce(new Error("Network unavailable"));
  renderCarousel();
  expect(await screen.findByRole("heading", { name: "Authentic UK sneakers. Delivered to Ghana." })).toBeInTheDocument();
  expect(screen.queryByTestId(/^hero-video-/)).not.toBeInTheDocument();
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

test("video slide advances at the loop boundary exactly once", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });

  const video = screen.getByTestId("hero-video-slide-v1");
  playToLoopBoundary(video);
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();

  // A further loop on the departed video should not double-advance
  wrapLoop(video);
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
});

test("video slide does not advance mid-clip, even after a long healthy playback", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });

  // 12s into a 20s clip: past the minimum, but not at a loop boundary.
  const video = screen.getByTestId("hero-video-slide-v1");
  let time = 0;
  Object.defineProperty(video, "duration", { configurable: true, value: 20 });
  Object.defineProperty(video, "currentTime", { configurable: true, get: () => time, set: (value) => { time = value; } });
  act(() => {
    for (time = 0; time <= 12; time += 1) video.dispatchEvent(new Event("timeupdate"));
  });
  expect(screen.getByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();
});

test("short clips loop until the minimum display time before advancing", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });

  const video = screen.getByTestId("hero-video-slide-v1");
  playToLoopBoundary(video, { duration: 5 });
  // One 5s pass is shorter than the minimum: the clip loops instead.
  expect(screen.getByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();
  wrapLoop(video);
  playToLoopBoundary(video, { duration: 5, from: 1 });
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
  playToLoopBoundary(video);
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

test("continues alternating videos without requiring the play button", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  await settle();

  playToLoopBoundary(screen.getByTestId("hero-video-slide-v1"));
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
  playToLoopBoundary(screen.getByTestId("hero-video-slide-v2"));
  expect(screen.getByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /play video/i })).not.toBeInTheDocument();
  expect(mockPlay).toHaveBeenCalledTimes(3);
});

test("stale play rejection from a previous video cannot block the next slide", async () => {
  let rejectOldPlay;
  mockPlay.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectOldPlay = reject; }));

  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  fireEvent.click(screen.getByRole("button", { name: /next slide/i }));
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();

  await act(async () => {
    rejectOldPlay(new DOMException("Playback interrupted", "AbortError"));
    await Promise.resolve();
  });

  expect(screen.queryByRole("button", { name: /play video/i })).not.toBeInTheDocument();
  playToLoopBoundary(screen.getByTestId("hero-video-slide-v2"));
  expect(screen.getByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();
});

test("transient AbortError retries the active video automatically", async () => {
  mockPlay.mockRejectedValueOnce(new DOMException("Playback interrupted", "AbortError"));
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  await settle();

  expect(mockPlay).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(350); });
  await settle();
  expect(mockPlay).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: /play video/i })).not.toBeInTheDocument();
});

test("unexpected pause automatically resumes an active video", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  await settle();
  mockPlay.mockClear();

  act(() => { screen.getByTestId("hero-video-slide-v1").dispatchEvent(new Event("pause")); });
  act(() => { jest.advanceTimersByTime(350); });
  await settle();

  expect(mockPlay).toHaveBeenCalled();
});

test("genuine autoplay policy rejection still provides manual playback", async () => {
  mockPlay.mockRejectedValueOnce(new DOMException("Not allowed", "NotAllowedError"));
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  await settle();

  expect(screen.getByRole("button", { name: /play video/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /next slide/i }));
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /play video/i })).not.toBeInTheDocument();
});

// --- Smooth start, loop, transition and mobile renditions ---

const CLOUDINARY_BASE = "https://res.cloudinary.com/dlsiabgiw/video/upload";

describe("Cloudinary hero renditions", () => {
  test("inserts the desktop and mobile video transformations", () => {
    expect(optimiseHeroVideoUrl(`${CLOUDINARY_BASE}/hero-video-1_kcv6pl.mp4`)).toBe(`${CLOUDINARY_BASE}/q_auto,w_1280,vc_h264/hero-video-1_kcv6pl.mp4`);
    expect(optimiseHeroVideoUrl(`${CLOUDINARY_BASE}/hero-video-1_kcv6pl.mp4`, "mobile")).toBe(`${CLOUDINARY_BASE}/q_auto,w_720,vc_h264/hero-video-1_kcv6pl.mp4`);
    expect(optimiseHeroVideoUrl(`${CLOUDINARY_BASE}/v1712/folder/clip.mp4`)).toBe(`${CLOUDINARY_BASE}/q_auto,w_1280,vc_h264/v1712/folder/clip.mp4`);
  });

  test("derives a matching-width first-frame poster", () => {
    expect(heroVideoPosterUrl(`${CLOUDINARY_BASE}/hero-video-2_nr2029.mp4`)).toBe(`${CLOUDINARY_BASE}/so_0,w_1280,q_auto,f_auto/hero-video-2_nr2029.jpg`);
    expect(heroVideoPosterUrl(`${CLOUDINARY_BASE}/hero-video-2_nr2029.mp4`, "mobile")).toBe(`${CLOUDINARY_BASE}/so_0,w_720,q_auto,f_auto/hero-video-2_nr2029.jpg`);
  });

  test("leaves non-Cloudinary URLs untouched", () => {
    expect(optimiseHeroVideoUrl("https://cdn.example.com/video/upload/clip.mp4", "mobile")).toBe("https://cdn.example.com/video/upload/clip.mp4");
    expect(optimiseHeroVideoUrl("/videos/clip.mp4")).toBe("/videos/clip.mp4");
    expect(optimiseHeroVideoUrl("https://res.cloudinary.com/demo/image/upload/shoe.jpg")).toBe("https://res.cloudinary.com/demo/image/upload/shoe.jpg");
    expect(heroVideoPosterUrl("https://cdn.example.com/clip.mp4")).toBe("");
  });

  test("admin-provided poster and mobile video win over derived renditions", () => {
    const slide = { ...videoSlide2, posterImage: "https://example.com/poster.jpg", mobileVideo: "https://example.com/mobile.mp4" };
    expect(resolveHeroVideo(slide, true)).toEqual({ src: "https://example.com/mobile.mp4", poster: "https://example.com/poster.jpg" });
    expect(resolveHeroVideo(slide, false)).toEqual({ src: `${CLOUDINARY_BASE}/q_auto,w_1280,vc_h264/hero-video-2_nr2029.mp4`, poster: "https://example.com/poster.jpg" });
    expect(resolveHeroVideo(videoSlide2, true)).toEqual({ src: `${CLOUDINARY_BASE}/q_auto,w_720,vc_h264/hero-video-2_nr2029.mp4`, poster: `${CLOUDINARY_BASE}/so_0,w_720,q_auto,f_auto/hero-video-2_nr2029.jpg` });
  });
});

test("video is looping, muted, inline and serves the optimised rendition with a poster", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  const video = screen.getByTestId("hero-video-slide-v2");
  expect(video).toHaveAttribute("loop");
  expect(video.muted).toBe(true);
  expect(video).toHaveAttribute("playsinline", "");
  expect(video).toHaveAttribute("src", `${CLOUDINARY_BASE}/q_auto,w_1280,vc_h264/hero-video-2_nr2029.mp4`);
  expect(video).toHaveAttribute("poster", `${CLOUDINARY_BASE}/so_0,w_1280,q_auto,f_auto/hero-video-2_nr2029.jpg`);
  expect(screen.getByTestId("hero-poster-slide-v2")).toHaveAttribute("src", video.getAttribute("poster"));
  expect(screen.getByTestId("hero-video-slide-v1")).toHaveAttribute("preload", "auto");
  expect(video).toHaveAttribute("preload", "metadata");
});

test("mobile viewports get the 720px rendition and poster", async () => {
  mockMatchMedia(["(max-width: 760px)"]);
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  const video = screen.getByTestId("hero-video-slide-v2");
  expect(video).toHaveAttribute("src", `${CLOUDINARY_BASE}/q_auto,w_720,vc_h264/hero-video-2_nr2029.mp4`);
  expect(video).toHaveAttribute("poster", `${CLOUDINARY_BASE}/so_0,w_720,q_auto,f_auto/hero-video-2_nr2029.jpg`);
});

test("video fades in only after it is actually playing", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  await settle();
  const video = screen.getByTestId("hero-video-slide-v1");
  expect(screen.getByTestId("hero-poster-slide-v1")).toBeInTheDocument();
  expect(video).not.toHaveClass("is-playing");

  act(() => { video.dispatchEvent(new Event("playing")); });
  expect(video).toHaveClass("is-playing");
});

test("autoplay rejection keeps the poster visible and the video hidden", async () => {
  mockPlay.mockRejectedValue(new DOMException("Low power mode", "NotAllowedError"));
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  await settle();
  expect(screen.getByTestId("hero-poster-slide-v1")).toHaveAttribute("src", videoSlide.posterImage);
  expect(screen.getByTestId("hero-video-slide-v1")).not.toHaveClass("is-playing");
  expect(screen.getByRole("button", { name: /play video/i })).toBeInTheDocument();
});

test("pause stops both the video and auto-advance; play resumes both", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  await settle();
  const video = screen.getByTestId("hero-video-slide-v1");

  mockPause.mockClear();
  fireEvent.click(screen.getByRole("button", { name: /pause carousel/i }));
  expect(mockPause).toHaveBeenCalled();
  playToLoopBoundary(video);
  act(() => jest.advanceTimersByTime(60_000));
  expect(screen.getByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();

  mockPlay.mockClear();
  fireEvent.click(screen.getByRole("button", { name: /play carousel/i }));
  await settle();
  expect(mockPlay).toHaveBeenCalled();
  playToLoopBoundary(video);
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
});

test("slide change runs the cinematic transition and settles afterwards", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  const section = screen.getByTestId("hero-carousel");
  expect(section).not.toHaveClass("hero-carousel--animated");

  fireEvent.click(screen.getByRole("button", { name: /next slide/i }));
  expect(section).toHaveClass("hero-carousel--animated");
  expect(section).not.toHaveClass("hero-carousel--backward");
  expect(screen.getByTestId("hero-media-slide-v2")).toHaveClass("is-active");
  expect(screen.getByTestId("hero-media-slide-v1")).toHaveClass("is-leaving");

  act(() => jest.advanceTimersByTime(950));
  expect(screen.getByTestId("hero-media-slide-v1")).not.toHaveClass("is-leaving");

  fireEvent.click(screen.getByRole("button", { name: /previous slide/i }));
  expect(section).toHaveClass("hero-carousel--backward");
});

test("reduced motion uses a plain crossfade without Ken Burns or wipe", async () => {
  mockMatchMedia(["(prefers-reduced-motion: reduce)"]);
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  const section = screen.getByTestId("hero-carousel");
  expect(section).toHaveClass("hero-carousel--reduced");

  fireEvent.click(screen.getByRole("button", { name: /next slide/i }));
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
  expect(section).not.toHaveClass("hero-carousel--animated");
});

test("arrow keys move between slides", async () => {
  renderCarousel();
  await screen.findByRole("heading", { name: "VIDEO SLIDE" });
  const next = screen.getByRole("button", { name: /next slide/i });
  fireEvent.keyDown(next, { key: "ArrowRight" });
  expect(screen.getByRole("heading", { name: "SECOND VIDEO" })).toBeInTheDocument();
  fireEvent.keyDown(next, { key: "ArrowLeft" });
  expect(screen.getByRole("heading", { name: "VIDEO SLIDE" })).toBeInTheDocument();
});
