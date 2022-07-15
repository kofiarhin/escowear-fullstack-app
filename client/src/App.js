import { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  BrowserRouter,
} from "react-router-dom";
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

const App = () => {
  const [category, setCategory] = useState("hoodies");
  const [showSideNav, setShowSideNav] = useState(false);
  const [search, setSearch] = useState("");

  const onSetCategory = (category) => {
    setCategory(category);
  };

  return (
    <div>
      <BrowserRouter>
        <Header setShowSideNav={setShowSideNav} />
        {showSideNav && <SideNav setShowSideNav={setShowSideNav} />}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/store"
            element={
              <Store
                category={category}
                setCategory={onSetCategory}
                searchField={search}
              />
            }
          />
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
