import {
  BrowserRouter as Router,
  Routes,
  Route,
  BrowserRouter,
} from "react-router-dom";
import Header from "./components/Header/Header.component";
import { useState, useEffect } from "react";
import {
  Register,
  Login,
  Home,
  Store,
  Cart,
  Details,
  DashBoard,
} from "./Pages";
import Logout from "./components/Logout/Logout.component";
import Footer from "./components/Footer/Footer.component";
import SideNav from "./components/SideNav/SideNav.component";

const App = () => {
  const initialState = () => {
    const user = localStorage.getItem("user");
    if (!user) {
      return null;
    }

    return JSON.parse(user);
  };
  const [user, setUser] = useState(initialState);
  const [category, setCategory] = useState("hoodies");
  const [showSideNav, setShowSideNav] = useState(true);

  const isLoggedIn = (data) => {
    setUser(data);
  };

  const onSetCategory = (category) => {
    setCategory(category);
  };

  return (
    <div>
      <BrowserRouter>
        <Header
          user={user}
          setCategory={onSetCategory}
          setShowSideNav={setShowSideNav}
        />
        {showSideNav && <SideNav setShowSideNav={setShowSideNav} />}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login setIsLoggedIn={isLoggedIn} />} />
          <Route
            path="/store"
            element={<Store category={category} setCategory={onSetCategory} />}
          />
          <Route path="/cart" element={<Cart user={user} />} />
          <Route path="/details/:id" element={<Details />} />
          <Route path="/dashboard" element={<DashBoard user={user} />} />
          <Route
            path="/logout"
            element={<Logout setIsLoggedIn={isLoggedIn} />}
          />
        </Routes>

        <Footer />
      </BrowserRouter>
    </div>
  );
};

export default App;
