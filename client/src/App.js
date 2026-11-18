import { useEffect, useState } from "react";
import { Routes, Route, BrowserRouter, useLocation, useNavigationType } from "react-router-dom";
import Header from "./components/Header/Header.component";
import Logout from "./components/Logout/Logout.component";
import Footer from "./components/Footer/Footer.component";
import SideNav from "./components/SideNav/SideNav.component";
import {
  Register,
  Login,
  Home,
  Store,
  Cart,
  Details,
  DashBoard,
  Account,
  Checkout,
  OrderConfirmation,
  AdminOverview,
  AdminOrders,
  AdminOrderDetail,
  AdminHeroSlides,
  AdminProducts,
  AdminProductForm,
  AdminFeaturedSneakers,
  TrackOrder,
  OrderDetails,
  Policies,
  ForgotPassword,
  ResetPassword,
  Wishlist,
} from "./Pages";

const SCROLL_STORAGE_KEY = "escowear-scroll-positions";

const ScrollToHash = () => {
  const { pathname, search, hash, key } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);

  useEffect(() => {
    const readPositions = () => {
      try {
        return JSON.parse(sessionStorage.getItem(SCROLL_STORAGE_KEY) || "{}");
      } catch {
        return {};
      }
    };

    const savePosition = () => {
      try {
        const positions = readPositions();
        positions[key] = { x: window.scrollX, y: window.scrollY };
        sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(positions));
      } catch {
        // Scroll navigation still works when session storage is unavailable.
      }
    };

    const positions = readPositions();
    const savedPosition = navigationType === "POP" ? positions[key] : null;
    const frame = window.requestAnimationFrame(() => {
      if (savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y)) {
        window.scrollTo(savedPosition.x, savedPosition.y);
      } else if (hash) {
        document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" });
      } else {
        window.scrollTo(0, 0);
      }
    });

    window.addEventListener("scroll", savePosition, { passive: true });
    window.addEventListener("pagehide", savePosition);

    return () => {
      window.cancelAnimationFrame(frame);
      savePosition();
      window.removeEventListener("scroll", savePosition);
      window.removeEventListener("pagehide", savePosition);
    };
  }, [pathname, search, hash, key, navigationType]);

  return null;
};

const App = () => {
  const [showSideNav, setShowSideNav] = useState(false);

  return (
    <div className="site-shell" id="top">
      <BrowserRouter>
        <ScrollToHash />
        <Header showSideNav={showSideNav} setShowSideNav={setShowSideNav} />
        {showSideNav && <SideNav setShowSideNav={setShowSideNav} />}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/store" element={<Store />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/wishlist" element={<Wishlist />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/orders/:id/confirmation" element={<OrderConfirmation />} />
          <Route path="/orders/:id" element={<OrderDetails />} />
          <Route path="/track-order" element={<TrackOrder />} />
          <Route path="/policies" element={<Policies />} />
          <Route path="/admin" element={<AdminOverview />} />
          <Route path="/admin/orders" element={<AdminOrders />} />
          <Route path="/admin/hero-slides" element={<AdminHeroSlides />} />
          <Route path="/admin/products" element={<AdminProducts />} />
          <Route path="/admin/products/featured" element={<AdminFeaturedSneakers />} />
          <Route path="/admin/products/new" element={<AdminProductForm />} />
          <Route path="/admin/products/:id/edit" element={<AdminProductForm />} />
          <Route path="/admin/orders/:id" element={<AdminOrderDetail />} />
          <Route path="/details/:id" element={<Details />} />
          <Route path="/account" element={<Account />} />
          <Route path="/dashboard" element={<DashBoard />} />
          <Route path="/logout" element={<Logout />} />
        </Routes>

        <Footer />
      </BrowserRouter>
    </div>
  );
};

export default App;
