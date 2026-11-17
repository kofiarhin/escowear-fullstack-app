// Static homepage discovery links. Every search term returns live catalogue
// results through the existing /store?search= route.
export const brandLinks = [
  { name: "Nike", logo: "nike", to: "/store?search=nike" },
  { name: "adidas", logo: "adidas", to: "/store?search=adidas" },
  { name: "Jordan", logo: "jordan", to: "/store?search=jordan" },
  { name: "New Balance", logo: "newbalance", to: "/store?search=new%20balance" },
  { name: "ASICS", logo: "asics", to: "/store?search=asics" },
  { name: "On Running", logo: "on", to: "/store?search=on%20running" },
];

// The search term also loads a representative product via /api/products?search=...&limit=1.
// No product URLs are pinned: images follow the current catalogue.
export const classicLinks = [
  { name: "Air Force 1", search: "air force", to: "/store?search=air%20force" },
  { name: "Dunk", search: "dunk", to: "/store?search=dunk" },
  { name: "Air Max", search: "air max", to: "/store?search=air%20max" },
  { name: "Samba", search: "samba", to: "/store?search=samba" },
  { name: "Spezial", search: "spezial", to: "/store?search=spezial" },
  { name: "Campus", search: "campus", to: "/store?search=campus" },
];

export const howSteps = [
  { title: "Browse", copy: "Choose authentic sneakers from our curated UK retailer selection." },
  { title: "Pay in GHS", copy: "See your total before checkout and pay Escowear in Ghana cedis." },
  { title: "We buy in the UK", copy: "After payment, we confirm availability and purchase your pair from a trusted retailer." },
  { title: "Delivered in Ghana", copy: "We arrange shipping and keep you updated until delivery." },
];
