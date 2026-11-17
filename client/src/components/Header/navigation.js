import { brandLinks, classicLinks } from "../../Pages/Home/homeContent";

export const MOBILE_MENU_ID = "mobile-menu";

const toLinks = (items) => items.map(({ name, to }) => ({ label: name, to }));

export const BRAND_LINKS = toLinks(brandLinks);

// Primary storefront navigation shared by the desktop mega-menu and the mobile
// overlay. Every destination is an existing route, homepage section or
// /store search, so nothing here can lead to an empty page.
export const PRIMARY_NAV = [
  {
    id: "shop",
    label: "Shop",
    to: "/store",
    groups: [
      {
        title: "Featured",
        links: [
          { label: "All sneakers", to: "/store?category=shoes" },
          { label: "New releases", to: "/#latest-releases" },
          { label: "The Classics", to: "/#classics" },
          { label: "Collections", to: "/#collections" },
        ],
      },
      { title: "Classic silhouettes", links: toLinks(classicLinks) },
    ],
  },
  {
    id: "brands",
    label: "Brands",
    to: "/#collections",
    groups: [
      { title: "Shop by brand", links: BRAND_LINKS },
      { title: "Explore", links: [{ label: "All brands", to: "/#collections" }] },
    ],
  },
  { id: "new", label: "New Releases", to: "/#latest-releases" },
  { id: "about", label: "About", to: "/#about" },
];
