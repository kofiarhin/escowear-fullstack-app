import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./heroCarousel.styles.css";

const AUTOPLAY_MS = 6000;
const Arrow = ({ direction }) => <svg viewBox="0 0 20 20" aria-hidden="true"><path d={direction === "previous" ? "M12.5 3.5 6 10l6.5 6.5M7 10h8" : "m7.5 3.5 6.5 6.5-6.5 6.5M13 10H5"} /></svg>;
const staticFallback = { headline: "Authentic UK sneakers. Delivered to Ghana.", description: "Choose your pair from trusted UK retailers and let Escowear handle the journey to Ghana." };
const readReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;

const HeroCarousel = () => {
  const [state, setState] = useState("loading");
  const [slides, setSlides] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [manualPause, setManualPause] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [isDocumentHidden, setIsDocumentHidden] = useState(() => document.hidden);
  const [reducedMotion, setReducedMotion] = useState(readReducedMotion);
  const pointerStart = useRef(null);
  const heroRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/hero-slides", { signal: controller.signal });
        if (!response.ok) throw new Error("Hero request failed");
        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items.filter((item) => item && item.id && item.productId && item.headline && item.desktopImage) : [];
        setSlides(items);
        setActiveIndex(0);
        setState(items.length ? "ready" : "fallback");
      } catch (error) {
        if (error.name !== "AbortError") setState("fallback");
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
  const isPaused = manualPause || isHovered || hasFocus || isDocumentHidden || reducedMotion;
  const goTo = (nextIndex) => { if (slides.length) setActiveIndex((nextIndex + slides.length) % slides.length); };

  useEffect(() => {
    if (!hasControls || isPaused) return undefined;
    const timer = window.setTimeout(() => setActiveIndex((index) => (index + 1) % slides.length), AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, hasControls, isPaused, slides.length]);

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

  const active = slides[activeIndex] || slides[0];
  return (
    <section ref={heroRef} className={`hero-carousel ${reducedMotion ? "hero-carousel--reduced" : ""}`} aria-roledescription="carousel" aria-label="Featured sneakers" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)} onFocusCapture={() => setHasFocus(true)} onBlurCapture={(event) => { if (!heroRef.current?.contains(event.relatedTarget)) setHasFocus(false); }} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { pointerStart.current = null; }}>
      <div className="hero-carousel__slides" aria-hidden="true">
        {slides.map((slide, index) => <picture className={`hero-carousel__media ${slide.desktopImage.startsWith("/images/shoes/") ? "hero-carousel__media--catalogue" : "hero-carousel__media--custom"} ${index === activeIndex ? "is-active" : ""}`} key={slide.id}>{slide.mobileImage && <source media="(max-width: 760px)" srcSet={slide.mobileImage} />}<img src={slide.desktopImage} alt="" fetchpriority={index === 0 ? "high" : "auto"} loading={index === 0 ? "eager" : "lazy"} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.style.display = "none"; }} /></picture>)}
      </div>
      <div className="hero-carousel__overlay" aria-hidden="true" />
      <div className="hero-carousel__copy" key={active.id}><p className="hero-carousel__eyebrow">Featured / {active.productName}</p><h1>{active.headline}</h1>{active.description && <p>{active.description}</p>}<Link className="hero-carousel__cta" to={`/details/${active.productId}`}>Shop Now <span aria-hidden="true">→</span></Link></div>
      {hasControls && <div className="hero-carousel__controls"><div className="hero-carousel__arrows" aria-label="Hero slide navigation"><button type="button" aria-label="Previous slide" onClick={() => goTo(activeIndex - 1)}><Arrow direction="previous" /></button><button type="button" aria-label="Next slide" onClick={() => goTo(activeIndex + 1)}><Arrow direction="next" /></button></div><div className="hero-carousel__dots" role="tablist" aria-label="Choose featured slide">{slides.map((slide, index) => <button key={slide.id} type="button" role="tab" aria-label={`Show slide ${index + 1}: ${slide.productName}`} aria-selected={index === activeIndex} onClick={() => goTo(index)}><span /></button>)}</div><button type="button" className="hero-carousel__pause" aria-label={manualPause ? "Play carousel" : "Pause carousel"} onClick={() => setManualPause((paused) => !paused)}>{manualPause ? "Play" : "Pause"}</button></div>}
    </section>
  );
};

export default HeroCarousel;
