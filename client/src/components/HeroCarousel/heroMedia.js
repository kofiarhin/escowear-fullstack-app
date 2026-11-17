// Cloudinary renditions for hero videos. The source uploads are 2.5K/4K
// (7–21 MB), which makes the first frames stutter on mobile; these widths
// keep each clip around 0.4–1.1 MB and its poster frame around 60–75 KB.
export const HERO_MOBILE_QUERY = "(max-width: 760px)";

const RENDITION_WIDTHS = { mobile: 720, desktop: 1280 };
const VIDEO_UPLOAD_SEGMENT = "/video/upload/";
const CLOUDINARY_HOST = /(^|\.)cloudinary\.com$/i;

// Returns null when the URL is not a Cloudinary video upload, so callers can
// decide whether to fall back to the original URL or to nothing.
const insertCloudinaryTransformation = (videoUrl, transformation, extension) => {
  if (!videoUrl) return null;
  let url;
  try {
    url = new URL(videoUrl);
  } catch {
    return null;
  }
  const index = url.pathname.indexOf(VIDEO_UPLOAD_SEGMENT);
  if (!CLOUDINARY_HOST.test(url.hostname) || index === -1) return null;

  const prefix = url.pathname.slice(0, index + VIDEO_UPLOAD_SEGMENT.length);
  let asset = url.pathname.slice(prefix.length);
  if (extension) asset = asset.replace(/\.[a-z0-9]+$/i, `.${extension}`);
  url.pathname = `${prefix}${transformation}/${asset}`;
  url.search = "";
  return url.toString();
};

export const optimiseHeroVideoUrl = (videoUrl, variant = "desktop") =>
  insertCloudinaryTransformation(videoUrl, `q_auto,w_${RENDITION_WIDTHS[variant]},vc_h264`) ?? videoUrl ?? "";

export const heroVideoPosterUrl = (videoUrl, variant = "desktop") =>
  insertCloudinaryTransformation(videoUrl, `so_0,w_${RENDITION_WIDTHS[variant]},q_auto,f_auto`, "jpg") ?? "";

// Admin-provided mobileVideo / posterImage always win over derived renditions.
export const resolveHeroVideo = (slide, isMobile = false) => {
  const variant = isMobile ? "mobile" : "desktop";
  const adminMobileVideo = isMobile && slide.mobileVideo ? slide.mobileVideo : "";
  const src = adminMobileVideo || optimiseHeroVideoUrl(slide.desktopVideo, variant);
  const poster = slide.posterImage
    || heroVideoPosterUrl(adminMobileVideo || slide.desktopVideo, variant)
    || (isMobile && slide.mobileImage)
    || slide.desktopImage
    || "";
  return { src, poster };
};
