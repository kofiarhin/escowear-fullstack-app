const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const { startTestApp, sampleProduct, userToken } = require("./helpers/testApp");

const createSlide = (productId, overrides = {}) => ({
  productId: String(productId),
  headline: "A SHOE WORTH THE JOURNEY",
  description: "Authentic pairs sourced in the UK.",
  desktopImage: "",
  mobileImage: "",
  order: 0,
  isActive: false,
  ...overrides,
});

test("public hero slides return only active, resolved products in stable order", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const first = await ctx.models.Product.create(sampleProduct({ name: "First pair", image: "https://images.example.test/first.jpg" }));
  const second = await ctx.models.Product.create(sampleProduct({ title: "Legacy pair", name: "", image: "", images: ["https://images.example.test/second.jpg"] }));
  await ctx.models.HeroSlide.create(createSlide(first._id, { order: 3, isActive: true }));
  await ctx.models.HeroSlide.create(createSlide(second._id, { order: 1, isActive: true, desktopImage: "/images/hero/second.jpg" }));
  await ctx.models.HeroSlide.create(createSlide(new Types.ObjectId(), { order: 0, isActive: true }));
  const draft = await ctx.models.Product.create(sampleProduct({ name: "Draft", status: "draft" }));
  await ctx.models.HeroSlide.create(createSlide(draft._id, { order: 0, isActive: true }));

  const response = await ctx.request("GET", "/api/hero-slides");
  assert.equal(response.status, 200);
  assert.equal(response.body.items.length, 2);
  assert.deepEqual(response.body.items.map((item) => item.productName), ["Legacy pair", "First pair"]);
  assert.equal(response.body.items[0].desktopImage, "/images/hero/second.jpg");
  assert.equal(response.body.items[0].mobileImage, "/images/hero/second.jpg");
  assert.equal(response.body.items[0].productInStock, true);
  assert.deepEqual(Object.keys(response.body.items[0]).sort(), ["description", "desktopImage", "desktopVideo", "headline", "id", "mobileImage", "mobileVideo", "order", "posterImage", "productId", "productInStock", "productName"].sort());
});

test("admin hero CRUD validates fields, product references, images and duplicate products", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const product = await ctx.models.Product.create(sampleProduct());
  const alternate = await ctx.models.Product.create(sampleProduct({ name: "Alternate pair" }));
  const token = userToken(admin._id);

  assert.equal((await ctx.request("GET", "/api/admin/hero-slides")).status, 401);
  assert.equal((await ctx.request("GET", "/api/admin/hero-slides", { token: userToken((await ctx.addUser())._id) })).status, 403);
  assert.equal((await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(product._id, { desktopImage: "javascript:alert(1)" }) })).status, 400);
  assert.equal((await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(new Types.ObjectId()) })).status, 404);

  const created = await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(product._id, { order: 2, desktopImage: "https://cdn.example.test/hero.jpg" }) });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.product.name, "Nike Air Max Dn8");
  const id = created.body.item.id;
  assert.equal((await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(product._id, { order: 1 }) })).status, 409);
  assert.equal((await ctx.request("PATCH", `/api/admin/hero-slides/${id}`, { token, body: { unknown: true } })).status, 400);
  assert.equal((await ctx.request("PATCH", `/api/admin/hero-slides/not-an-id`, { token, body: { headline: "Valid" } })).status, 400);
  const updated = await ctx.request("PATCH", `/api/admin/hero-slides/${id}`, { token, body: { productId: String(alternate._id), headline: "UPDATED HEADLINE", description: "", mobileImage: "/images/hero/mobile.jpg", isActive: true } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.item.productId, String(alternate._id));
  assert.equal(updated.body.item.isActive, true);
  assert.equal((await ctx.request("DELETE", `/api/admin/hero-slides/${id}`, { token })).status, 204);
  assert.equal((await ctx.request("GET", "/api/admin/hero-slides", { token })).body.items.length, 0);
});

test("admin rejects a ninth active slide without partial writes, including concurrent requests", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const token = userToken(admin._id);
  const products = await Promise.all(Array.from({ length: 10 }, (_, index) => ctx.models.Product.create(sampleProduct({ name: `Pair ${index}` }))));
  for (let index = 0; index < 7; index += 1) {
    const result = await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(products[index]._id, { order: index, isActive: true }) });
    assert.equal(result.status, 201);
  }
  const results = await Promise.all([7, 8, 9].map((index) => ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(products[index]._id, { order: index, isActive: true }) })));
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.status === 409).length, 2);
  assert.equal(ctx.models.HeroSlide.docs.filter((slide) => slide.isActive).length, 8);
  assert.equal(ctx.models.HeroSlide.docs.length, 8);
});

test("admin rejects a ninth slide of any status with SLIDE_LIMIT and allows it again after a delete", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const token = userToken(admin._id);
  const products = await Promise.all(Array.from({ length: 10 }, (_, index) => ctx.models.Product.create(sampleProduct({ name: `Pair ${index}` }))));
  const ids = [];
  for (let index = 0; index < 8; index += 1) {
    const result = await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(products[index]._id, { order: index, isActive: index < 2 }) });
    assert.equal(result.status, 201);
    ids.push(result.body.item.id);
  }

  for (const isActive of [false, true]) {
    const ninth = await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(products[8]._id, { order: 8, isActive, desktopVideo: "https://res.cloudinary.com/demo/video/upload/ninth.mp4" }) });
    assert.equal(ninth.status, 409);
    assert.equal(ninth.body.code, "SLIDE_LIMIT");
    assert.equal(ninth.body.error, "Only eight hero slides are allowed");
  }
  assert.equal(ctx.models.HeroSlide.docs.length, 8);

  assert.equal((await ctx.request("DELETE", `/api/admin/hero-slides/${ids[0]}`, { token })).status, 204);
  const replacement = await ctx.request("POST", "/api/admin/hero-slides", { token, body: createSlide(products[9]._id, { order: 0, desktopVideo: "https://res.cloudinary.com/demo/video/upload/replacement.mp4" }) });
  assert.equal(replacement.status, 201);
  assert.equal(replacement.body.item.desktopVideo, "https://res.cloudinary.com/demo/video/upload/replacement.mp4");
});

test("activating a slide still respects ACTIVE_SLIDE_LIMIT for legacy collections above the total cap", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const token = userToken(admin._id);
  const products = await Promise.all(Array.from({ length: 9 }, (_, index) => ctx.models.Product.create(sampleProduct({ name: `Pair ${index}` }))));
  // Written straight to the model: the API no longer allows a ninth slide.
  for (let index = 0; index < 8; index += 1) await ctx.models.HeroSlide.create(createSlide(products[index]._id, { order: index, isActive: true }));
  const draft = await ctx.models.HeroSlide.create(createSlide(products[8]._id, { order: 8, isActive: false, desktopImage: "/images/hero/legacy.jpg" }));

  const activated = await ctx.request("PATCH", `/api/admin/hero-slides/${draft._id}`, { token, body: { isActive: true } });
  assert.equal(activated.status, 409);
  assert.equal(activated.body.code, "ACTIVE_SLIDE_LIMIT");

  // Editing a draft without activating it keeps working and leaves its image untouched.
  const edited = await ctx.request("PATCH", `/api/admin/hero-slides/${draft._id}`, { token, body: { headline: "STILL A DRAFT", desktopVideo: "https://res.cloudinary.com/demo/video/upload/legacy.mp4" } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.item.desktopImage, "/images/hero/legacy.jpg");
  assert.equal(edited.body.item.desktopVideo, "https://res.cloudinary.com/demo/video/upload/legacy.mp4");
});

test("video fields are accepted, persisted, returned and validated correctly", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const token = userToken(admin._id);
  const product = await ctx.models.Product.create(sampleProduct());
  const alternate = await ctx.models.Product.create(sampleProduct({ name: "Alternate pair" }));

  // Create a video slide with all three new fields
  const created = await ctx.request("POST", "/api/admin/hero-slides", {
    token,
    body: createSlide(product._id, {
      order: 0,
      desktopVideo: "https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-1_kcv6pl.mp4",
      mobileVideo: "https://res.cloudinary.com/dlsiabgiw/video/upload/w_768/hero-video-1_kcv6pl.mp4",
      posterImage: "https://res.cloudinary.com/dlsiabgiw/video/upload/so_0/hero-video-1_kcv6pl.jpg",
      isActive: true,
    }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.item.desktopVideo, "https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-1_kcv6pl.mp4");
  assert.equal(created.body.item.mobileVideo, "https://res.cloudinary.com/dlsiabgiw/video/upload/w_768/hero-video-1_kcv6pl.mp4");
  assert.equal(created.body.item.posterImage, "https://res.cloudinary.com/dlsiabgiw/video/upload/so_0/hero-video-1_kcv6pl.jpg");
  const id = created.body.item.id;

  // Public endpoint returns video fields
  const pub = await ctx.request("GET", "/api/hero-slides");
  assert.equal(pub.body.items[0].desktopVideo, "https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-1_kcv6pl.mp4");
  assert.equal(pub.body.items[0].mobileVideo, "https://res.cloudinary.com/dlsiabgiw/video/upload/w_768/hero-video-1_kcv6pl.mp4");
  assert.equal(pub.body.items[0].posterImage, "https://res.cloudinary.com/dlsiabgiw/video/upload/so_0/hero-video-1_kcv6pl.jpg");

  // Patch to remove video (revert to image slide)
  const cleared = await ctx.request("PATCH", `/api/admin/hero-slides/${id}`, { token, body: { desktopVideo: "", mobileVideo: "", posterImage: "" } });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.item.desktopVideo, "");

  // Patch to add video back
  const restored = await ctx.request("PATCH", `/api/admin/hero-slides/${id}`, { token, body: { desktopVideo: "https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-2_nr2029.mp4" } });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.item.desktopVideo, "https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-2_nr2029.mp4");

  // Image-only slides still work (default empty video fields)
  const imageSlide = await ctx.request("POST", "/api/admin/hero-slides", {
    token,
    body: createSlide(alternate._id, { order: 1, isActive: true }),
  });
  assert.equal(imageSlide.status, 201);
  assert.equal(imageSlide.body.item.desktopVideo, "");
  assert.equal(imageSlide.body.item.mobileVideo, "");
  assert.equal(imageSlide.body.item.posterImage, "");
});

test("video source validation rejects invalid schemes, embed URLs and unsupported formats", async (t) => {
  const ctx = await startTestApp();
  t.after(ctx.close);
  const admin = await ctx.addUser({ role: "admin" });
  const token = userToken(admin._id);
  const product = await ctx.models.Product.create(sampleProduct());

  const base = createSlide(product._id, { order: 0 });

  // Reject player.cloudinary.com embed URL with actionable error
  const embed = await ctx.request("POST", "/api/admin/hero-slides", {
    token,
    body: { ...base, desktopVideo: "https://player.cloudinary.com/embed/?cloud_name=dlsiabgiw&public_id=hero-video-1_kcv6pl" },
  });
  assert.equal(embed.status, 400);
  assert.ok(embed.body.fields.desktopVideo.includes("delivery URL"));

  // Reject javascript: scheme
  const js = await ctx.request("POST", "/api/admin/hero-slides", {
    token,
    body: { ...base, desktopVideo: "javascript:alert(1)" },
  });
  assert.equal(js.status, 400);

  // Reject http: (not https)
  const http = await ctx.request("POST", "/api/admin/hero-slides", {
    token,
    body: { ...base, desktopVideo: "http://example.com/video.mp4" },
  });
  assert.equal(http.status, 400);

  // Reject URL with credentials
  const creds = await ctx.request("POST", "/api/admin/hero-slides", {
    token,
    body: { ...base, desktopVideo: "https://user:pass@cdn.example.com/video.mp4" },
  });
  assert.equal(creds.status, 400);

  // Reject URL without video extension
  const noExt = await ctx.request("POST", "/api/admin/hero-slides", {
    token,
    body: { ...base, desktopVideo: "https://cdn.example.com/video" },
  });
  assert.equal(noExt.status, 400);

  // Reject HTML page URL
  const html = await ctx.request("POST", "/api/admin/hero-slides", {
    token,
    body: { ...base, desktopVideo: "https://cdn.example.com/page.html" },
  });
  assert.equal(html.status, 400);

  // Accept valid .webm URL
  const webm = await ctx.request("POST", "/api/admin/hero-slides", {
    token,
    body: { ...base, desktopVideo: "https://res.cloudinary.com/dlsiabgiw/video/upload/hero-video-1_kcv6pl.webm" },
  });
  assert.equal(webm.status, 201);

  // posterImage uses image validation rules
  const product2 = await ctx.models.Product.create(sampleProduct({ name: "Pair two" }));
  const badPoster = await ctx.request("POST", "/api/admin/hero-slides", {
    token,
    body: createSlide(product2._id, { order: 1, posterImage: "javascript:alert(1)" }),
  });
  assert.equal(badPoster.status, 400);
  assert.ok(badPoster.body.fields.posterImage);
});
