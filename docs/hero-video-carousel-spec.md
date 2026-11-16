Escowear — Nike-Inspired Video Hero Carousel
Status: Implemented — video-only homepage carousel
Date: 15 November 2026
Repository: kofiarhin/escowear-fullstack-app
Source baseline: Claude's inspection of master at fd4d213; re-check against the active feature branch before implementation.
Scope: Extend the existing hero carousel to support Cloudinary video slides with readable text overlays, while preserving image slides and admin management.

1. Outcome and boundaries
   Build a full-width, Nike-inspired homepage hero using the existing HeroCarousel. Videos fill the hero behind an HTML headline, description, and Shop Now CTA. Slides may be images or videos, in any order. The admin can manage video URLs, optional posters, text, product links, activation, and order through the existing hero-slide workflow.

Initial Cloudinary assets (cloud dlsiabgiw):

- hero-video-2_nr2029
- hero-video-1_kcv6pl
  Provided URLs use player.cloudinary.com/embed/; these are not valid HTML5 video sources. The intended delivery URLs are:
- https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-2_nr2029.mp4
- https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-1_kcv6pl.mp4
  Verification gate: Confirm these exact delivery URLs return playable video before seeding or configuring slides. Their accessibility and encoding are assumptions, not verified results.

In scope: Mixed image/video slides, muted inline video, readable overlays, existing product CTA, navigation, explicit pause/play, responsive design, poster/error fallback, reduced-motion support, admin fields, backend validation, tests.

Out of scope: Uploading video files from the admin, changing the product-linked CTA model, audio playback, HLS/DASH, new carousel dependencies, automatic production data changes, deployment. 2. Existing architecture (reported by original inspection)
File Current role Required change
client/src/components/HeroCarousel/HeroCarousel.component.js Fetches /api/hero-slides; image slides, crossfade, navigation, pause and reduced motion Add video rendering and lifecycle
client/src/components/HeroCarousel/heroCarousel.styles.css Hero layout, overlay, animation and responsive rules Video sizing, poster fallback and stronger text gradient
client/src/components/HeroCarousel/HeroCarousel.test.js Carousel interaction tests Add video/mixed-media tests
client/src/Pages/AdminHeroSlides/AdminHeroSlides.page.js Product-linked slide CRUD, headline, description, images, order and active state Video/poster inputs, preview and type label
client/src/Pages/AdminHeroSlides/adminHeroSlides.styles.css Admin styling New fields and preview styling
client/src/Pages/AdminHeroSlides/AdminHeroSlides.test.js Admin form tests Video field tests
server/Models/HeroSlide.model.js Mongoose hero slide model Three optional media fields
server/controllers/heroSlidesController.js Public/admin serialization and validated CRUD Validate and serialize media fields
server/tests/heroSlides.test.js API tests Video CRUD and validation tests

The original inspection also identified:

- client/src/Pages/Home/Home.page.js renders <HeroCarousel /> and should not need changes.
- server/routes/heroSlidesRoute.js exposes GET /api/hero-slides.
- server/routes/adminRoute.js protects admin CRUD with authentication, admin authorization and rate limiting.
- Existing active-slide limit: 8; product association and product-detail CTA remain mandatory.
- Existing image-slide timing: 10 seconds; crossfade and keyboard/swipe navigation already exist.
  These are reported source findings, not a fresh inspection of the current checkout. Confirm filenames, validation rules, and existing tests before modifying code.

3. Design and interaction requirements
   3.1 Appearance

- Hero fills the available horizontal width and uses the existing responsive height rules as a starting point.
- Video is full-bleed with object-fit: cover; preserve the subject using a sensible object-position and optional mobile-specific video.
- Headline, description and Shop Now CTA are real HTML elements layered over the video, not burned into the video.
- Apply a strong enough gradient behind the copy for consistent contrast on moving footage. Keep focus indicators and controls legible.
- Desktop: text aligned left. Mobile: text near the bottom-left with safe padding, avoiding navigation controls.
- Reuse existing arrows, dots, swipe, focus handling and crossfade. A thin progress bar is optional polish, not a launch blocker.
  3.2 Media behavior
- Use native <video muted playsInline>; request autoplay programmatically only when the slide is active, visible, not manually paused and reduced motion is off.
- Do not pause on hover. Hover must not stop video or slide progression. Existing focus-based pause should be reviewed: preserve keyboard usability without leaving playback permanently frozen when controls retain focus.
- Explicit Pause stops both the video and carousel advancement; Play resumes from the same playback position.
- On navigation, pause and reset the departing video. Start the newly active video only if playback is allowed.
- Video slides advance on ended; image slides retain their 10-second timer.
- A single video slide loops continuously while playback is enabled; no slide-advance timer is needed.
- On reduced motion, show the poster, do not autoplay video or auto-advance slides; manual navigation still works.
- When the document is hidden, pause playback and advancement. Resume only if no other pause condition applies.
  3.3 Reliable advancement and stalls
  Do not use an unconditional 30-second timer. It would cut off healthy videos longer than 30 seconds.
- Register only one transition handler for the active slide. Use cleanup and a transition guard to prevent ended, error and stall handlers from advancing twice.
- For video, advance normally on ended.
- Detect genuine lack of progress using waiting/`stalled`, timeupdate and a watchdog that resets on playback progress. A suggested starting threshold is 15 seconds without progress while the video is expected to play; tune after real-browser testing.
- The watchdog must be disabled while manually paused, tab-hidden, waiting for user action after autoplay rejection, or under reduced motion.
- On sustained stall or media error, keep the poster visible and advance to the next slide once (if another slide exists). With one slide, remain on the poster and show a usable manual retry control if practical.
- If video.play() rejects (e.g. autoplay policy), do not silently leave a blank or endlessly stalled slide. Show the poster and a clear manual play option; never start a watchdog that loops through slides without giving the user control.
- Use event listeners/effects with proper cleanup on slide changes and unmount. Avoid stale closures and double timers.

4. Data model
   Add three optional fields to server/Models/HeroSlide.model.js:
   desktopVideo: { type: String, default: '', maxlength: 2048 },
   mobileVideo: { type: String, default: '', maxlength: 2048 },
   posterImage: { type: String, default: '', maxlength: 2048 },
   A slide is a video slide when desktopVideo is nonempty; otherwise it remains an image slide. Do not add a separate slideType field unless implementation reveals a real need. Existing fields remain unchanged: productId, headline, description, desktopImage, mobileImage, order, isActive.

Conditional validity: Image slides require their existing image data. Video slides require a valid desktopVideo and a guaranteed displayable poster fallback. An explicit posterImage is preferred; otherwise derive a Cloudinary frame and validate that it resolves, or use a valid existing image. Do not allow an active slide that can render completely blank. mobileVideo is optional and falls back to desktopVideo.

No migration is expected for existing image-only documents: absent video fields are treated as empty. Confirm actual Mongoose serialization and existing controller constraints. Existing indexes and the eight-active-slide limit remain unchanged. 5. API and validation
Extend the existing endpoints, without adding routes:

- GET /api/hero-slides: include desktopVideo, mobileVideo, posterImage in each public item, defaulting to ''.
- GET /api/admin/hero-slides: include the same fields.
- POST/PATCH /api/admin/hero-slides: accept and validate the three fields; preserve authorization, serialized writes, existing product rules, order and active limits.
  For desktopVideo and mobileVideo:

1. Accept an empty string or a well-formed HTTPS direct media delivery URL (not an HTML player page).
2. Reject player.cloudinary.com/embed/ URLs with an actionable error explaining the correct delivery format.
3. Reject embedded credentials, control characters, surrounding whitespace, and values over 2048 characters.
4. For the MVP, prefer Cloudinary res.cloudinary.com/.../video/upload/... URLs and check for an allowed video format/extension such as .mp4 or .webm (including safe query parameters). If non-Cloudinary hosts are needed later, define and test an explicit allowlist instead of accepting arbitrary HTTPS pages.
5. Validate posterImage as a supported image URL under the existing image-source rules.
6. Enforce the conditional image/video requirements server-side, not only in the admin form.
   URL validation checks syntax and trusted structure; it does not prove the asset exists. The admin preview and integration verification must catch missing or unplayable files. Avoid fetching arbitrary user-supplied URLs from the backend.
7. Cloudinary delivery
Use HTML5-compatible video URLs, not the embed/player iframe. Example:
<video muted playsinline poster="https://res.cloudinary.com/dlsiabgiw/video/upload/so_0/hero-video-1_kcv6pl.jpg">
  <source src="https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-1_kcv6pl.mp4" type="video/mp4" />
</video>
The URLs above are patterns to verify, not guaranteed accessible assets. Do not assume .webm variants exist without testing. Use Cloudinary transformations for sensible dimensions and quality after confirming supported delivery. Prefer a correctly sized mobile derivative when needed, not automatically a second full-resolution file.

Poster precedence: explicit posterImage → valid Cloudinary-generated frame → valid desktopImage/product image → neutral background with visible text and controls. A broken derived frame must not suppress a working image fallback. The frontend must not blindly rewrite arbitrary external URLs into Cloudinary-style posters.

If the app introduces a CSP later, allow the required Cloudinary host in media-src and img-src. 7. Frontend implementation
7.1 HeroCarousel.component.js

- Keep existing fetching, fallback states, slide ordering, overlays, CTA, arrows/dots and swipe.
- Extend filtering so valid video slides do not require desktopImage, provided their poster/fallback rules are met.
- Add isVideoSlide(slide), a Cloudinary-only poster helper, and video refs keyed by slide ID.
- Render <video> for video slides and the existing <picture> for image slides.
- Render a stable poster/image layer behind the video so media errors cannot leave an empty hero. Hide/reveal video based on readiness and errors; do not hide the only visible poster.
- Avoid loading inactive videos eagerly. Only the active video should have an active source; consider warming the next video with preload="metadata" after the current slide is ready and network conditions permit. Merely setting preload="none" is a browser hint, not a guarantee that a src won't download.
- Use play() and pause() in lifecycle effects; catch rejected play() promises and surface a manual-play state.
- Handle pause, hidden tab, reduced motion, manual navigation, ended, errors and stalls using the single-advance rule from §3.3.
- Do not reset currentTime when resuming from a manual pause. Reset only when leaving the slide or intentionally restarting it.
- If using responsive <source media>, test browser behavior on viewport changes; a stable single source or explicit React-selected URL may be safer. Do not trigger desktop and mobile downloads simultaneously.
  7.2 heroCarousel.styles.css
- Video fills the existing media layer using position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover.
- Place poster below video, gradient above media, and copy/controls above gradient.
- Use a class such as .hero-carousel--video-active on the carousel root to control video-specific overlay styles; avoid needing :has().
- Ensure responsive text contrast and layout at 375px, 760px, 900px and wide desktop sizes.
- Reduced-motion mode disables decorative motion and relies on the poster.
- Optional progress bar uses actual video currentTime / duration; handle unknown/zero duration and keep updates efficient.
  7.3 Timing and state invariants
- At most one active video may play.
- At most one slide-advance action may run per completion/failure event.
- Image slides never depend on video events.
- A paused or hidden carousel never advances itself.
- A successful video may play beyond 30 seconds without interruption.
- Switching slides clears old listeners, watchdogs and pending timers.

8. Admin dashboard
   Extend AdminHeroSlides.page.js and its stylesheet:

- Add Desktop video URL, optional Mobile video URL, and optional Poster image URL fields.
- Include these fields in blank/edit form state and POST/PATCH bodies.
- Label slides Video or Image in the admin list.
- Provide a muted preview with controls or a manual preview-play action; show clear errors for unsupported/unavailable URLs.
- Explain that Cloudinary delivery URLs are required, not player.cloudinary.com/embed links.
- Preserve product selection, headline (90 characters), description (180 characters), CTA behavior, order and active state.
- Recommend a small optimized video (initial guidance: target under 15 MB where feasible), but do not imply a URL-based form can enforce upload size.
- Explain that video slides should have a poster; preview both video and poster before activation.
  Do not add video upload handling or new backend upload routes.

9. Performance and accessibility
   Performance

- Show a lightweight poster immediately; avoid blank hero frames.
- Do not download all carousel videos on initial page load.
- Prioritize first-slide poster for initial visual rendering; avoid unnecessarily forcing the full video into the critical page-load path.
- Apply Cloudinary size/quality transformations and test mobile payloads.
- Measure LCP, CLS, network bytes and actual playback on throttled mobile connections.
- Track Cloudinary bandwidth cost if traffic grows.
  Accessibility
- Keep HTML overlay text and CTA accessible even when media is decorative and aria-hidden.
- Provide visible, keyboard-operable previous/next, pause/play and slide selectors with clear labels.
- Do not trap keyboard focus; avoid duplicate active-slide headings or links being exposed to assistive technology.
- Respect prefers-reduced-motion: poster-only by default, no automatic advancement.
- Ensure text contrast over bright and dark frames; test on both supplied videos.
- Muted videos do not need audio controls; do not add an unrequested sound feature.

10. Failure handling
    Scenario Required behavior
    Video loads and plays Overlay remains readable; advance on ended
    Healthy video longer than 30 seconds Continue until actual end
    Video stalls without progress After progress-based timeout, show poster and advance once (unless single slide)
    Media URL invalid or 404 Keep poster/fallback visible, show nonblocking failure state, advance safely
    Autoplay rejected Keep poster, offer manual play; no runaway slide cycling
    Explicit pause Freeze video and advancement; resume at same position
    Hover Continue playing; hover alone is not a pause reason
    Hidden tab Pause and stop timers; resume when visible if permitted
    Reduced motion Poster only; manual navigation remains available
    Single video slide Loop on successful playback; do not auto-advance
    No valid poster Use image/product fallback, then a styled nonblank background
    Image slide Preserve existing 10-second behavior
    Mobile source unavailable Use verified desktop source or poster fallback

11. Testing and acceptance criteria
    Backend: server/tests/heroSlides.test.js

- Create, update, remove and retrieve the three optional media fields.
- Existing image-only documents still serialize correctly.
- Reject invalid schemes, credentials, malformed URLs, embed/player URLs and unsupported formats.
- Validate poster image URL and conditional video/image media requirements.
- Verify ordering, active-slide limit, admin permissions and public filtering remain intact.
  Carousel: HeroCarousel.test.js
- Render image and video slides, including a video with no desktopImage but a valid poster.
- Verify muted, playsInline, poster and active-source selection.
- ended advances exactly once; long healthy playback is not cut off.
- Simulated stalled playback triggers exactly one guarded fallback transition.
- Pause/resume preserves playback position; navigation resets departed video.
- Hover does not pause video or slide progression.
- Hidden document and reduced-motion state stop autoplay.
- Autoplay rejection and video errors preserve poster and allow recovery.
- One video slide loops; image slides retain 10-second timer.
- Existing image-only carousel tests still pass.
  Admin: AdminHeroSlides.test.js
- New fields render, populate during edit and submit correctly.
- Slide type labels and previews work.
- Invalid embed URLs produce clear guidance.
- Existing product and image management continues working.
  Manual browser verification
- Both provided Cloudinary delivery URLs are reachable and playable.
- Desktop, tablet and mobile layouts show readable overlays and usable controls.
- Throttled network shows poster promptly and no unexpected large preloads.
- Chrome/Edge and mobile Safari playback behavior is verified where devices are available.
- No console errors or double slide transitions.
  Acceptance: All checks above pass or limitations are documented; no image-slide regression, no new dependency, and no production changes.

12. Implementation sequence
1. Verify baseline and assets: Reinspect current feature branch and confirm Cloudinary MP4/poster delivery, source formats, and existing tests.
1. Backend slice: Add model fields, validation, serialization and focused tests.
1. Frontend slice: Add poster layer, active-only video, lifecycle/advance guards, error and reduced-motion behavior, styling and tests.
1. Admin slice: Add URL/poster fields, validation feedback, preview, type labels and tests.
1. Integration: Configure two test slides in a nonproduction environment, exercise mixed media and mobile behavior, measure performance, fix regressions.
   Expected modified files: The nine files listed in §2. No new routes, dependencies or database migration are expected. Additional files require a clear implementation reason.
1. Decisions and assumptions
   Topic Decision
   Single video Loop while playback is permitted
   Hover Never pauses video
   Explicit pause Pauses media and carousel advancement
   Progress indicator Optional, after core behavior works
   Video URL input Full direct delivery URL, including extension
   CSS overlay state Root class, not :has()
   File size Recommend optimized videos, target <15 MB where practical; no hard URL-size enforcement
   Stall handling Progress-based watchdog, not fixed total video duration
   Poster Must remain visible on errors; verify derivation
   Dependencies None added unless justified by actual codebase constraints

Remaining verification items: Actual availability/codec of both Cloudinary files; actual source code on current feature branch; poster URL response; exact mobile crop and video dimensions; availability of real-device Safari testing. Do not present these as verified until checked. 14. Change control and completion

- Implement on the existing feature branch, not master.
- Keep current uncommitted spec and unrelated changes intact.
- Before coding, confirm the repository state and report unexpected changes.
- Do not alter production data, push, merge, deploy or commit without explicit user approval.
- On completion, report changed files, focused test/build results, manual verification performed, and remaining limitations. Distinguish implemented from verified.
