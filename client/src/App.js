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
} from "./Pages";

const ScrollToHash = () => {
  const { pathname, hash, key } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    // Let the browser restore scroll when going Back or Forward.
    if (navigationType === "POP" && !hash) return undefined;

    const frame = window.requestAnimationFrame(() => {
      if (hash) {
        document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
      } else {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [pathname, hash, key, navigationType]);

  return null;
};

const App = () => {
  const [showSideNav, setShowSideNav] = useState(false);

  return (
    <div className="site-shell" id="top">
      <BrowserRouter>
        <ScrollToHash />
        <Header setShowSideNav={setShowSideNav} />
        {showSideNav && <SideNav setShowSideNav={setShowSideNav} />}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/store" element={<Store />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/details/:id" element={<Details />} />
          <Route path="/dashboard" element={<DashBoard />} />
          <Route path="/logout" element={<Logout />} />
        </Routes>

        <Footer />
      </BrowserRouter>
    </div>
  );
};

export default App;
