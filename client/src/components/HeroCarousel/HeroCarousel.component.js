import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./heroCarousel.styles.css";

const AUTOPLAY_MS = 10_000;
const STALL_TIMEOUT_MS = 15_000;
const Arrow = ({ direction }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={direction === "previous" ? "M12.5 3.5 6 10l6.5 6.5M7 10h8" : "m7.5 3.5 6.5 6.5-6.5 6.5M13 10H5"} /></svg>;
const staticFallback = { headline: "Authentic UK sneakers. Delivered to Ghana.", description: "Choose your pair from trusted UK retailers and let Escowear handle the journey to Ghana." };

const DEFAULT_VIDEO_SLIDES = [
  {
    id: "video-hero-1", productId: "", productName: "Escowear", productInStock: true,
    headline: "STEP INTO STYLE", description: "Premium sneakers delivered from the UK to your doorstep in Ghana.",
    desktopImage: "", mobileImage: "",
    desktopVideo: "https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-2_nr2029.mp4",
    mobileVideo: "", posterImage: "", order: 0,
  },
  {
    id: "video-hero-2", productId: "", productName: "Escowear", productInStock: true,
    headline: "AUTHENTIC KICKS", description: "Trusted UK retailers. Verified authenticity. Fast delivery to Ghana.",
    desktopImage: "", mobileImage: "",
    desktopVideo: "https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-1_kcv6pl.mp4",
    mobileVideo: "", posterImage: "", order: 1,
  },
];
const readReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;

const isVideoSlide = (slide) => Boolean(slide && slide.desktopVideo);

const deriveCloudinaryPoster = (videoUrl) => {
  if (!videoUrl) return "";
  try {
    const url = new URL(videoUrl);
    if (!url.hostname.endsWith("cloudinary.com")) return "";
    const path = url.pathname.replace(/\.(mp4|webm)$/i, ".jpg");
    const parts = path.split("/upload/");
    if (parts.length === 2) {
      url.pathname = parts[0] + "/upload/so_0/" + parts[1];
      url.search = "";
      return url.toString();
    }
  } catch { /* ignore */ }
  return "";
};

const resolvePoster = (slide) => {
  if (slide.posterImage) return slide.posterImage;
  const derived = deriveCloudinaryPoster(slide.desktopVideo);
  if (derived) return derived;
  if (slide.desktopImage) return slide.desktopImage;
  return "";
};

const HeroCarousel = () => {
  const [state, setState] = useState("loading");
  const [slides, setSlides] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [manualPause, setManualPause] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [isDocumentHidden, setIsDocumentHidden] = useState(() => document.hidden);
  const [reducedMotion, setReducedMotion] = useState(readReducedMotion);
  const [blockedSlideId, setBlockedSlideId] = useState(null);
  const pointerStart = useRef(null);
  const heroRef = useRef(null);
  const videoRefs = useRef({});
  const advanceGuard = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/hero-slides", { signal: controller.signal });
        if (!response.ok) throw new Error("Hero request failed");
        const data = await response.json();
        const all = Array.isArray(data?.items) ? data.items.filter((item) => item && item.id && item.headline && (item.desktopImage || item.desktopVideo)) : [];
        const videoItems = all.filter((item) => item.desktopVideo);
        const items = videoItems.length ? videoItems : DEFAULT_VIDEO_SLIDES;
        setSlides(items);
        setActiveIndex(0);
        setState(items.length ? "ready" : "fallback");
      } catch (error) {
        if (error.name !== "AbortError") {
          setSlides(DEFAULT_VIDEO_SLIDES);
          setActiveIndex(0);
          setState("ready");
        }
      }
    };
    load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return undefined;
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const updateVisibility = () => setIsDocumentHidden(document.hidden);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const hasControls = slides.length > 1;
  // Per spec: hover does NOT pause video or slide progression.
  // Focus-based pause only applies when controls have focus and slide is an image,
  // to preserve keyboard usability without freezing video playback.
  const active = slides[activeIndex] || slides[0];
  const activeIsVideo = isVideoSlide(active);
  const autoplayBlocked = blockedSlideId === active?.id;
  const isStopped = manualPause || isDocumentHidden || reducedMotion;
  const isPaused = isStopped || (!activeIsVideo && hasFocus);

  const goTo = useCallback((nextIndex) => {
    if (!slides.length) return;
    setBlockedSlideId(null);
    setActiveIndex((nextIndex + slides.length) % slides.length);
  }, [slides.length]);

  // Keep the active video playing. An interrupted play() request is not an
  // autoplay-policy rejection and must never leave the carousel blocked.
  useEffect(() => {
    if (!active || !isVideoSlide(active)) return undefined;
    const video = videoRefs.current[active.id];
    if (!video) return undefined;

    if (isStopped) {
      video.pause();
      return undefined;
    }
    if (autoplayBlocked) return undefined;

    let cancelled = false;
    let retryTimer = null;
    let retryCount = 0;
    let playInFlight = false;

    const handlePlayError = (error) => {
      playInFlight = false;
      if (cancelled) return;
      if (error?.name === "NotAllowedError") {
        // Only a genuine browser permission refusal needs a user gesture.
        setBlockedSlideId(active.id);
      } else if (error?.name === "AbortError" && retryCount < 1) {
        // Media loads and slide changes can harmlessly interrupt play().
        retryCount += 1;
        retryTimer = window.setTimeout(startPlayback, 350);
      }
    };

    const startPlayback = () => {
      if (cancelled || !video.paused || playInFlight) return;
      playInFlight = true;
      try {
        Promise.resolve(video.play()).then(
          () => { playInFlight = false; },
          handlePlayError
        );
      } catch (error) {
        handlePlayError(error);
      }
    };

    const onUnexpectedPause = () => {
      if (cancelled || video.ended) return;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(startPlayback, 350);
    };

    // Resume after transient buffering or an unexpected browser pause.
    video.addEventListener("canplay", startPlayback);
    video.addEventListener("pause", onUnexpectedPause);
    startPlayback();

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      video.removeEventListener("canplay", startPlayback);
      video.removeEventListener("pause", onUnexpectedPause);
    };
  }, [active, isStopped, autoplayBlocked]);

  // Reset departed videos and warm next slide
  useEffect(() => {
    const activeId = active?.id;
    Object.entries(videoRefs.current).forEach(([id, video]) => {
      if (video && id !== activeId) {
        video.pause();
        video.currentTime = 0;
        video.removeAttribute("preload");
      }
    });
    // Warm next slide's video with metadata preload
    if (hasControls && slides.length > 1) {
      const nextIndex = (activeIndex + 1) % slides.length;
      const nextSlide = slides[nextIndex];
      if (isVideoSlide(nextSlide)) {
        const nextVideo = videoRefs.current[nextSlide.id];
        if (nextVideo) nextVideo.preload = "metadata";
      }
    }
  }, [activeIndex, active, hasControls, slides]);

  // Advance guard: increment on slide change to prevent stale handlers from double-advancing
  useEffect(() => {
    advanceGuard.current += 1;
  }, [activeIndex]);

  // Auto-advance logic: video ended / image timer / stall watchdog
  useEffect(() => {
    if (isPaused) return undefined;

    const currentGuard = advanceGuard.current;
    const advanceOnce = () => {
      if (advanceGuard.current !== currentGuard) return;
      advanceGuard.current += 1;
      setBlockedSlideId(null);
      setActiveIndex((index) => (index + 1) % slides.length);
    };

    if (activeIsVideo) {
      const video = videoRefs.current[active?.id];
      if (!video) return undefined;

      // Single video slide: loop
      if (slides.length === 1) {
        video.loop = true;
        return () => { video.loop = false; };
      }
      video.loop = false;

      // Multi-slide: advance on ended
      const onEnded = () => advanceOnce();
      video.addEventListener("ended", onEnded);

      // Stall watchdog: resets on timeupdate, fires after STALL_TIMEOUT_MS without progress
      let stallTimer = null;
      const resetStallTimer = () => {
        if (stallTimer !== null) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => advanceOnce(), STALL_TIMEOUT_MS);
      };
      const onTimeUpdate = () => resetStallTimer();
      const onError = () => advanceOnce();
      video.addEventListener("timeupdate", onTimeUpdate);
      video.addEventListener("error", onError);
      // Start the watchdog
      resetStallTimer();

      return () => {
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("error", onError);
        if (stallTimer !== null) clearTimeout(stallTimer);
      };
    }

    // Image slides: existing 10-second timer
    if (!hasControls) return undefined;
    const timer = window.setTimeout(advanceOnce, AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, activeIsVideo, hasControls, isPaused, slides, active]);

  // Keep the direct call in the click handler for browsers requiring a gesture.
  const handleManualPlay = () => {
    setBlockedSlideId(null);
    const video = videoRefs.current[active?.id];
    if (!video) return;
    const onError = (error) => {
      if (error?.name === "NotAllowedError") setBlockedSlideId(active.id);
    };
    try {
      const result = video.play();
      if (result && typeof result.catch === "function") result.catch(onError);
    } catch (error) {
      onError(error);
    }
  };

  const onPointerDown = (event) => { pointerStart.current = { x: event.clientX, y: event.clientY }; };
  const onPointerUp = (event) => {
    if (!pointerStart.current || !hasControls) return;
    const deltaX = event.clientX - pointerStart.current.x;
    const deltaY = event.clientY - pointerStart.current.y;
    pointerStart.current = null;
    if (Math.abs(deltaX) < 44 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    goTo(activeIndex + (deltaX < 0 ? 1 : -1));
  };

  if (state === "loading") return <section className="hero-carousel hero-carousel--loading" aria-label="Loading homepage feature" aria-busy="true"><span /></section>;
  if (state === "fallback") return <section className="hero-carousel hero-carousel--fallback" aria-labelledby="fallback-hero-title"><div className="hero-carousel__fallback-image" aria-hidden="true" /><div className="hero-carousel__overlay" aria-hidden="true" /><div className="hero-carousel__copy hero-carousel__copy--fallback"><p className="hero-carousel__eyebrow">Escowear / UK to Ghana</p><h1 id="fallback-hero-title">{staticFallback.headline}</h1><p>{staticFallback.description}</p><Link className="hero-carousel__cta" to="/store">Shop Now</Link></div></section>;

  const rootClasses = [
    "hero-carousel",
    reducedMotion ? "hero-carousel--reduced" : "",
    activeIsVideo ? "hero-carousel--video-active" : "",
  ].filter(Boolean).join(" ");

  return (
    <section ref={heroRef} className={rootClasses} data-testid="hero-carousel" aria-roledescription="carousel" aria-label="Featured sneakers" onFocusCapture={() => setHasFocus(true)} onBlurCapture={(event) => { if (!heroRef.current?.contains(event.relatedTarget)) setHasFocus(false); }} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { pointerStart.current = null; }}>
      <div className="hero-carousel__slides" aria-hidden="true">
        {slides.map((slide, index) => {
          const isActive = index === activeIndex;
          if (isVideoSlide(slide)) {
            const poster = resolvePoster(slide);
            return (
              <div className={`hero-carousel__media hero-carousel__media--video ${isActive ? "is-active" : ""}`} key={slide.id}>
                <video
                  ref={(el) => {
                    if (el) videoRefs.current[slide.id] = el;
                    else delete videoRefs.current[slide.id];
                  }}
                  data-testid={`hero-video-${slide.id}`}
                  muted
                  playsInline
                  preload={index === 0 ? "auto" : "none"}
                  poster={poster || undefined}
                >
                  <source src={slide.desktopVideo} type="video/mp4" />
                </video>
              </div>
            );
          }
          return (
            <picture className={`hero-carousel__media ${slide.desktopImage.startsWith("/images/shoes/") ? "hero-carousel__media--catalogue" : "hero-carousel__media--custom"} ${isActive ? "is-active" : ""}`} key={slide.id}>
              {slide.mobileImage && <source media="(max-width: 760px)" srcSet={slide.mobileImage} />}
              <img src={slide.desktopImage} alt="" fetchpriority={index === 0 ? "high" : "auto"} loading={index === 0 ? "eager" : "lazy"} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.style.display = "none"; }} />
            </picture>
          );
        })}
      </div>
      <div className="hero-carousel__overlay" aria-hidden="true" />
      <div className="hero-carousel__copy" key={active.id}>
        <p className="hero-carousel__eyebrow">{active.productId ? `Featured / ${active.productName}` : "Escowear / UK to Ghana"}</p>
        <h1>{active.headline}</h1>
        {active.description && <p>{active.description}</p>}
        <Link className="hero-carousel__cta" to={active.productId ? `/details/${active.productId}` : "/store"}>Shop Now <span aria-hidden="true">&rarr;</span></Link>
      </div>
      {autoplayBlocked && activeIsVideo && (
        <button type="button" className="hero-carousel__manual-play" aria-label="Play video" onClick={handleManualPlay}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5,3 19,12 5,21" /></svg>
        </button>
      )}
      {hasControls && <div className="hero-carousel__controls"><div className="hero-carousel__arrows" aria-label="Hero slide navigation"><button type="button" aria-label="Previous slide" onClick={() => goTo(activeIndex - 1)}><Arrow direction="previous" /></button><button type="button" aria-label="Next slide" onClick={() => goTo(activeIndex + 1)}><Arrow direction="next" /></button></div><div className="hero-carousel__dots" role="tablist" aria-label="Choose featured slide">{slides.map((slide, index) => <button key={slide.id} type="button" role="tab" aria-label={`Show slide ${index + 1}: ${slide.productName}`} aria-selected={index === activeIndex} onClick={() => goTo(index)}><span /></button>)}</div><button type="button" className="hero-carousel__pause" aria-label={manualPause ? "Play carousel" : "Pause carousel"} onClick={() => setManualPause((paused) => !paused)}>{manualPause ? "Play" : "Pause"}</button></div>}
    </section>
  );
};

export default HeroCarousel;
