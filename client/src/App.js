import {
  BrowserRouter as Router,
  Routes,
  Route,
  BrowserRouter,
} from "react-router-dom";
import ProductList from "./components/ProductList/ProductList.component";
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

  const isLoggedIn = (data) => {
    setUser(data);
  };

  const onSetCategory = (category) => {
    setCategory(category);
  };

  return (
    <div>
      <BrowserRouter>
        <Header user={user} setCategory={onSetCategory} />
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
      </BrowserRouter>
    </div>
  );
};

export default App;
