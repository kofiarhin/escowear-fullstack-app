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
  const itemCount = items.reduce((total, item) => total + item.quantity, 0);

  if (!items.length) {
    return (
      <main className="cart container">
        <section className="cart-empty">
          <p className="cart-eyebrow">Your cart</p>
          <h1>Your cart is empty</h1>
          <p className="cart-empty-copy">Find your next pair from our latest UK sneaker drops.</p>
          <Link className="cart-button cart-button-primary" to="/store">Continue Shopping</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="cart container">
      <header className="cart-header">
        <div>
          <p className="cart-eyebrow">{itemCount} {itemCount === 1 ? "item" : "items"}</p>
          <h1 className="title">Your Cart</h1>
        </div>
        <Link className="cart-link" to="/store">Continue shopping</Link>
      </header>

      <div className="cart-layout">
        <ul className="cart-items">
          {items.map((item, index) => {
            const unitPrice = Math.round(item.price * 100);
            return (
              <li className="cart-item" key={item.productId + ":" + item.size}>
                <div className="cart-item-media">
                  <img src={getProductImage(item)} alt={item.name} onError={useFallbackProductImage} />
                </div>
                <div className="cart-item-info">
                  <h2>{item.name}</h2>
                  <p className="cart-item-size">Size: {item.size}</p>
                  <p className="cart-item-unit">{formatGBP(unitPrice)} each</p>
                </div>
                <div className="cart-item-controls">
                  <div className="cart-qty">
                    <label htmlFor={`cart-qty-${index}`}>Quantity</label>
                    <div className="cart-qty-stepper">
                      <button type="button" aria-label={`Decrease quantity of ${item.name}`} disabled={item.quantity <= 1} onClick={() => changeQuantity(index, item.quantity - 1)}>−</button>
                      <input id={`cart-qty-${index}`} type="number" min="1" max={MAX_CART_QUANTITY} value={item.quantity} onChange={e => changeQuantity(index, Number(e.target.value))} />
                      <button type="button" aria-label={`Increase quantity of ${item.name}`} disabled={item.quantity >= MAX_CART_QUANTITY} onClick={() => changeQuantity(index, item.quantity + 1)}>+</button>
                    </div>
                  </div>
                  <p className="cart-item-total">Line total: <span>{formatGBP(unitPrice * item.quantity)}</span></p>
                  <button type="button" className="cart-remove" aria-label={`Remove ${item.name} ${item.size}`} onClick={() => update(items.filter((_, position) => position !== index))}>Remove</button>
                </div>
              </li>
            );
          })}
        </ul>

        <aside className="cart-summary" aria-label="Order summary">
          <h2>Summary</h2>
          <dl>
            <div><dt>Items</dt><dd>{itemCount}</dd></div>
            <div className="cart-summary-subtotal"><dt>Indicative subtotal</dt><dd>{formatGBP(cartSubtotal(items))}</dd></div>
          </dl>
          <p className="cart-summary-note">No payment now. Final availability, shipping and Ghana cedi payment amount will be confirmed by email.</p>
          <Link className="cart-button cart-button-primary place-order" to="/checkout">Continue to checkout</Link>
          <button className="cart-button cart-button-secondary clear-cart" type="button" onClick={() => update([])}>Clear Cart</button>
        </aside>
      </div>
    </main>
  );
};
export default Cart;
