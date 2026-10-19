import { useState } from "react";
import { Link } from "react-router-dom";
import { getProductImage, useFallbackProductImage } from "../../utils/product";
import { readCart, saveCart, cartSubtotal, MAX_CART_QUANTITY } from "../../utils/cart";
import "./cart.styles.css";

const formatGBP = pennies => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pennies / 100);

const Cart = () => {
  const [items, setItems] = useState(readCart);
  const update = next => { saveCart(next); setItems(next); };
  const changeQuantity = (index, quantity) => {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY) return;
    update(items.map((item, position) => position === index ? { ...item, quantity } : item));
  };
  return (
    <main className="cart">
      <h1 className="title">Your Cart</h1>
      <div className="container">
        {items.length ? <>
          {items.map((item, index) => <div className="item-unit" key={item.productId + ":" + item.size}>
            <img src={getProductImage(item)} alt={item.name} onError={useFallbackProductImage} />
            <div className="content">
              <h2>{item.name}</h2>
              <p>Size: {item.size}</p>
              <p>{formatGBP(Math.round(item.price * 100))} each</p>
              <label htmlFor={`cart-qty-${index}`}>Quantity</label>
              <input id={`cart-qty-${index}`} type="number" min="1" max={MAX_CART_QUANTITY} value={item.quantity} onChange={e => changeQuantity(index, Number(e.target.value))} />
              <p>Line total: {formatGBP(Math.round(item.price * 100) * item.quantity)}</p>
              <button type="button" onClick={() => update(items.filter((_, position) => position !== index))}>Remove</button>
            </div>
          </div>)}
          <div className="totals"><h2>Indicative subtotal: {formatGBP(cartSubtotal(items))}</h2><p>Final availability, shipping and Ghana cedi payment amount will be confirmed later.</p></div>
          <div className="button-wrapper">
            <button className="clear-cart" type="button" onClick={() => update([])}>Clear Cart</button>
            <button className="place-order" type="button" disabled title="Guest checkout is being built in IDE-115">Checkout coming soon</button>
          </div>
        </> : <><p>Your cart is empty</p><Link to="/store">Browse sneakers</Link></>}
      </div>
    </main>
  );
};
export default Cart;
