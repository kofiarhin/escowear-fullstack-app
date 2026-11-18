import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { HERO_MOBILE_QUERY, resolveHeroVideo } from "./heroMedia";
import "./heroCarousel.styles.css";

const SLIDE_INTERVAL_S = 5;
const AUTOPLAY_MS = SLIDE_INTERVAL_S * 1000;
const STALL_TIMEOUT_MS = 15_000;
// Keep in sync with the hero media animations in heroCarousel.styles.css.
const TRANSITION_MS = 950;
const REDUCED_TRANSITION_MS = 300;
const Arrow = ({ direction }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={direction === "previous" ? "M12.5 3.5 6 10l6.5 6.5M7 10h8" : "m7.5 3.5 6.5 6.5-6.5 6.5M13 10H5"} /></svg>;
const staticFallback = { headline: "Authentic UK sneakers. Delivered to Ghana.", description: "Choose your pair from trusted UK retailers and let Escowear handle the journey to Ghana." };

const isVideoSlide = (slide) => Boolean(slide && slide.desktopVideo);

const readMediaQuery = (query) => window.matchMedia?.(query).matches || false;
const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => readMediaQuery(query));
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return undefined;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return matches;
};

const HeroCarousel = () => {
  const [state, setState] = useState("loading");
  const [slides, setSlides] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [leavingIndex, setLeavingIndex] = useState(null);
  const [direction, setDirection] = useState("next");
  const [hasMoved, setHasMoved] = useState(false);
  const [playingIds, setPlayingIds] = useState({});
  const [manualPause, setManualPause] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [isDocumentHidden, setIsDocumentHidden] = useState(() => document.hidden);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const isMobile = useMediaQuery(HERO_MOBILE_QUERY);
  const [blockedSlideId, setBlockedSlideId] = useState(null);
  const pointerStart = useRef(null);
  const heroRef = useRef(null);
  const videoRefs = useRef({});
  const advanceGuard = useRef(0);
  const loopProgress = useRef({ id: null, played: 0, last: null });

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/hero-slides", { signal: controller.signal });
        if (!response.ok) throw new Error("Hero request failed");
        const data = await response.json();
        // Each published slide plays its video when it has one; legacy
        // image-only slides still render with their image (the API resolves
        // the product image when no custom image was set).
        const published = Array.isArray(data?.items) ? data.items.filter((item) => item && item.id && item.headline && (item.desktopImage || item.desktopVideo)) : [];
        const items = published;
        setSlides(items);
        setActiveIndex(0);
        setState(items.length ? "ready" : "fallback");
      } catch (error) {
        if (error.name !== "AbortError") {
          setSlides([]);
          setActiveIndex(0);
          setState("fallback");
        }
      }
    };
    load();
    return () => controller.abort();
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
  const nextIndex = hasControls ? (activeIndex + 1) % slides.length : -1;

  const goTo = useCallback((targetIndex, travel) => {
    if (!slides.length) return;
    const target = (targetIndex + slides.length) % slides.length;
    if (target === activeIndex) return;
    setBlockedSlideId(null);
    setDirection(travel || (target > activeIndex ? "next" : "previous"));
    setLeavingIndex(activeIndex);
    setHasMoved(true);
    setActiveIndex(target);
  }, [slides.length, activeIndex]);

  const markPlaying = useCallback((id) => {
    setPlayingIds((ids) => (ids[id] ? ids : { ...ids, [id]: true }));
  }, []);

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
        // Only a genuine browser permission refusal (autoplay policy, iOS
        // low-power mode) needs a user gesture; the poster stays visible.
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

  // The outgoing slide keeps playing while it animates out; once the
  // transition finishes it is rewound so it re-enters on its poster frame.
  useEffect(() => {
    if (leavingIndex === null) return undefined;
    const timer = window.setTimeout(() => setLeavingIndex(null), reducedMotion ? REDUCED_TRANSITION_MS : TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [leavingIndex, activeIndex, reducedMotion]);

  useEffect(() => {
    const visibleIds = new Set([slides[activeIndex]?.id, slides[leavingIndex]?.id]);
    Object.entries(videoRefs.current).forEach(([id, video]) => {
      if (!video || visibleIds.has(id)) return;
      video.pause();
      if (video.currentTime !== 0) video.currentTime = 0;
    });
    setPlayingIds((ids) => {
      const staleIds = Object.keys(ids).filter((id) => !visibleIds.has(id));
      if (!staleIds.length) return ids;
      const next = { ...ids };
      staleIds.forEach((id) => { delete next[id]; });
      return next;
    });
  }, [activeIndex, leavingIndex, slides]);

  // Advance guard: increment on slide change to prevent stale handlers from double-advancing
  useEffect(() => {
    advanceGuard.current += 1;
  }, [activeIndex]);

  // Auto-advance logic: video loop boundary / image timer / stall watchdog
  useEffect(() => {
    if (isPaused || !hasControls) return undefined;

    const currentGuard = advanceGuard.current;
    const advanceOnce = () => {
      if (advanceGuard.current !== currentGuard) return;
      advanceGuard.current += 1;
      goTo(activeIndex + 1, "next");
    };

    if (activeIsVideo) {
      const video = videoRefs.current[active?.id];
      if (!video) return undefined;

      // Playback time survives pause/resume of the same slide.
      if (loopProgress.current.id !== active.id) loopProgress.current = { id: active.id, played: 0, last: null };
      else loopProgress.current.last = null;
      const progress = loopProgress.current;

      // Stall watchdog: resets on timeupdate, fires after STALL_TIMEOUT_MS without progress
      let stallTimer = null;
      const resetStallTimer = () => {
        if (stallTimer !== null) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => advanceOnce(), STALL_TIMEOUT_MS);
      };

      const onTimeUpdate = () => {
        resetStallTimer();
        const time = video.currentTime;
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        const wrapped = progress.last !== null && time < progress.last - 0.5;
        if (wrapped) progress.played += (duration ? Math.max(0, duration - progress.last) : 0) + time;
        else if (progress.last !== null && time - progress.last < 1.5) progress.played += time - progress.last;
        progress.last = time;

        // Count real playback rather than wall-clock time, so a clip that is
        // still buffering is seen for the full interval. Longer clips are cut
        // mid-play; the outgoing video keeps playing under the transition.
        if (progress.played >= SLIDE_INTERVAL_S) advanceOnce();
      };
      const onError = () => advanceOnce();
      video.addEventListener("timeupdate", onTimeUpdate);
      video.addEventListener("error", onError);
      // Start the watchdog
      resetStallTimer();

      return () => {
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("error", onError);
        if (stallTimer !== null) clearTimeout(stallTimer);
      };
    }

    // Image slides use the same interval as video slides.
    const timer = window.setTimeout(advanceOnce, AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, activeIsVideo, hasControls, isPaused, active, goTo]);

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
    if (deltaX < 0) goTo(activeIndex + 1, "next");
    else goTo(activeIndex - 1, "previous");
  };
  const onKeyDown = (event) => {
    if (!hasControls) return;
    if (event.key === "ArrowRight") goTo(activeIndex + 1, "next");
    else if (event.key === "ArrowLeft") goTo(activeIndex - 1, "previous");
    else return;
    event.preventDefault();
  };

  if (state === "loading") return <section className="hero-carousel hero-carousel--loading" aria-label="Loading homepage feature" aria-busy="true"><span /></section>;
  if (state === "fallback") return <section className="hero-carousel hero-carousel--fallback" aria-labelledby="fallback-hero-title"><div className="hero-carousel__fallback-image" aria-hidden="true" /><div className="hero-carousel__overlay" aria-hidden="true" /><div className="hero-carousel__copy hero-carousel__copy--fallback"><p className="hero-carousel__eyebrow">Escowear / UK to Ghana</p><h1 id="fallback-hero-title">{staticFallback.headline}</h1><p>{staticFallback.description}</p><Link className="hero-carousel__cta" to="/store">Shop Now</Link></div></section>;

  const rootClasses = [
    "hero-carousel",
    reducedMotion ? "hero-carousel--reduced" : "",
    // Cinematic transitions only after the first slide change, so the first
    // paint is immediate (poster first, then the video fades in).
    hasMoved && !reducedMotion ? "hero-carousel--animated" : "",
    direction === "previous" ? "hero-carousel--backward" : "",
    activeIsVideo ? "hero-carousel--video-active" : "",
  ].filter(Boolean).join(" ");
  const layerState = (index) => {
    if (index === activeIndex) return "is-active";
    return index === leavingIndex ? "is-leaving" : "";
  };

  return (
    <section ref={heroRef} className={rootClasses} data-testid="hero-carousel" aria-roledescription="carousel" aria-label="Featured sneakers" onKeyDown={onKeyDown} onFocusCapture={() => setHasFocus(true)} onBlurCapture={(event) => { if (!heroRef.current?.contains(event.relatedTarget)) setHasFocus(false); }} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { pointerStart.current = null; }}>
      <div className="hero-carousel__slides" aria-hidden="true">
        {slides.map((slide, index) => {
          const isActive = index === activeIndex;
          if (isVideoSlide(slide)) {
            const { src, poster } = resolveHeroVideo(slide, isMobile);
            // Five seconds is too short to start fetching the next clip on
            // arrival, so it buffers fully while the current slide plays.
            const preload = isActive || index === leavingIndex || index === nextIndex ? "auto" : "none";
            return (
              <div className={`hero-carousel__media hero-carousel__media--video ${layerState(index)}`} data-testid={`hero-media-${slide.id}`} key={slide.id}>
                {poster && <img className="hero-carousel__poster" data-testid={`hero-poster-${slide.id}`} src={poster} alt="" decoding="async" fetchpriority={index === 0 ? "high" : "low"} />}
                <video
                  ref={(el) => {
                    if (el) videoRefs.current[slide.id] = el;
                    else delete videoRefs.current[slide.id];
                  }}
                  className={`hero-carousel__video ${playingIds[slide.id] ? "is-playing" : ""}`}
                  data-testid={`hero-video-${slide.id}`}
                  src={src}
                  muted
                  loop
                  playsInline
                  autoPlay={isActive && !isStopped}
                  preload={preload}
                  poster={poster || undefined}
                  onPlaying={() => markPlaying(slide.id)}
                  onTimeUpdate={(event) => { if (!event.currentTarget.paused && event.currentTarget.currentTime > 0) markPlaying(slide.id); }}
                />
              </div>
            );
          }
          return (
            <picture className={`hero-carousel__media ${slide.desktopImage.startsWith("/images/shoes/") ? "hero-carousel__media--catalogue" : "hero-carousel__media--custom"} ${layerState(index)}`} key={slide.id}>
              {slide.mobileImage && <source media={HERO_MOBILE_QUERY} srcSet={slide.mobileImage} />}
              <img data-testid={`hero-image-${slide.id}`} src={slide.desktopImage} alt="" fetchpriority={index === 0 ? "high" : "auto"} loading={index === 0 ? "eager" : "lazy"} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.style.display = "none"; }} />
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
      {hasControls && <div className="hero-carousel__controls"><div className="hero-carousel__arrows" aria-label="Hero slide navigation"><button type="button" aria-label="Previous slide" onClick={() => goTo(activeIndex - 1, "previous")}><Arrow direction="previous" /></button><button type="button" aria-label="Next slide" onClick={() => goTo(activeIndex + 1, "next")}><Arrow direction="next" /></button></div><div className="hero-carousel__dots" role="tablist" aria-label="Choose featured slide">{slides.map((slide, index) => <button key={slide.id} type="button" role="tab" aria-label={`Show slide ${index + 1}: ${slide.productName}`} aria-selected={index === activeIndex} onClick={() => goTo(index)}><span /></button>)}</div><button type="button" className="hero-carousel__pause" aria-label={manualPause ? "Play carousel" : "Pause carousel"} onClick={() => setManualPause((paused) => !paused)}>{manualPause ? "Play" : "Pause"}</button></div>}
    </section>
  );
};

export default HeroCarousel;
