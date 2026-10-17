import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  formatProductPrice,
  getProductImage,
  useFallbackProductImage,
} from "../../utils/product";
import "./cart.styles.css";
const Cart = ({ user }) => {
  const [cartData, setCartData] = useState([]);
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    // get data from session storage

    let cartData = sessionStorage.getItem("cartData");

    if (cartData) {
      cartData = JSON.parse(cartData);
      setCartData(cartData);
    }
  }, []);

  const removeItem = (position) => {
    const filtered = cartData.filter((item, index) => index !== position);
    sessionStorage.setItem("cartData", JSON.stringify(filtered));

    setCartData(filtered);
  };

  const clearCart = () => {
    sessionStorage.setItem("cartData", "");
    setCartData([]);
  };
  const placeOrder = async () => {
    fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${user.token}`,
      },
      body: JSON.stringify(cartData),
    })
      .then((response) => response.json())
      .then((data) => {
        // clear cart
        sessionStorage.setItem("cartData", "");
        setCartData([]);
        navigate("/dashboard");
      })
      .catch((error) => console.log("ther was a problem making order"));
  };

  const renderTotals = () => {
    let sum = 0;
    cartData.forEach((item) => {
      const price = Number(item.price);
      if (Number.isFinite(price)) sum += price;
    });

    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(sum);
  };

  return (
    <div className="cart">
      <h1 className="title"> Your Cart </h1>

      {message ? <h2 className="info"> {message} </h2> : null}
      <div className="container">
        {cartData.length > 0 ? (
          <div>
            {cartData.map((item, index) => {
              return (
                <div className="item-unit" key={index}>
                  <img
                    src={getProductImage(item)}
                    alt={item.name}
                    onError={useFallbackProductImage}
                  />
                  <div className="content">
                    <h1> {item.name} </h1>
                    <h2>{formatProductPrice(item)} </h2>
                    <button onClick={() => removeItem(index)}>Remove</button>
                  </div>
                </div>
              );
            })}

            {/* order totals */}
            <div className="totals">
              <h1>
                {" "}
                Total: <span>{renderTotals()}</span>{" "}
              </h1>
            </div>
            {/* cta */}
            <div className="button-wrapper">
              <button className="clear-cart" onClick={() => clearCart()}>
                Clear Cart
              </button>{" "}
              {/* check if user is logged in  */}
              {user ? (
                <button className="place-order" onClick={() => placeOrder()}>
                  Place Order
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <h1 className="title">Your cart is empty</h1>
        )}
      </div>
    </div>
  );
};

export default Cart;
