import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { addCartItem, readCart, saveCart } from "../../utils/cart";
import {
  formatProductCategory,
  formatProductPrice,
  formatProductSize,
  getAvailabilityLabel,
  getProductImage,
  useFallbackProductImage,
} from "../../utils/product";

const RemoveButton = ({ name, onRemove }) => (
  <button type="button" className="wishlist-remove" aria-label={`Remove ${name} from wishlist`} onClick={onRemove}>
    Remove
  </button>
);

const lineQuantity = (items, productId, size) =>
  items.find((item) => item.productId === String(productId) && item.size === size)?.quantity || 0;

// Adds one pair using the same validation as the product page. addCartItem
// returns the cart unchanged when size, stock or price rules reject it, and
// clamps at the per-line maximum, so success means the line quantity grew.
const addToCart = (product, size) => {
  const current = readCart();
  const updated = addCartItem(current, product, size, 1);
  if (lineQuantity(updated, product._id, size) <= lineQuantity(current, product._id, size)) return false;
  try {
    saveCart(updated);
  } catch {
    return false;
  }
  return true;
};

const UnavailableItem = ({ id, status, position, onRemove, onRetry }) => {
  const isMissing = status === "missing";
  // Numbered so several unavailable entries have distinguishable Remove buttons.
  const label = `${isMissing ? "Unavailable sneaker" : "Saved sneaker"} ${position}`;
  const titleId = useId();
  return (
    <li className="wishlist-item is-unavailable" aria-labelledby={titleId}>
      <div className="wishlist-item-media" aria-hidden="true"></div>
      <div className="wishlist-item-body">
        <p className="wishlist-item-title" id={titleId}>
          {isMissing ? "This sneaker is no longer available." : "We couldn't load this sneaker."}
        </p>
        <p className="wishlist-item-note">
          {isMissing ? "It may have sold through or been removed from the store." : "Check your connection and try again."}
        </p>
        <div className="wishlist-item-actions">
          {!isMissing && (
            <button type="button" className="wishlist-cart-button" onClick={() => onRetry(id)}>
              Try again
            </button>
          )}
          <RemoveButton name={label} onRemove={() => onRemove(label)} />
        </div>
      </div>
    </li>
  );
};

const LoadingItem = () => (
  <li className="wishlist-item is-loading" aria-hidden="true">
    <div className="wishlist-item-media"></div>
    <div className="wishlist-item-body">
      <span className="wishlist-skeleton"></span>
      <span className="wishlist-skeleton is-short"></span>
    </div>
  </li>
);

const ReadyItem = ({ product, onRemove }) => {
  const [selectedSize, setSelectedSize] = useState("");
  const [feedback, setFeedback] = useState(null);
  const sizes = [...new Set((product.sizes || []).map(formatProductSize).filter(Boolean))];
  const soldOut = product.inStock === false;
  const price = formatProductPrice(product);
  const sizeGroupId = useId();
  const titleId = useId();

  const handleAdd = () => {
    if (!selectedSize) return;
    setFeedback(
      addToCart(product, selectedSize)
        ? { ok: true, text: `${product.name} (${selectedSize}) added to your cart.` }
        : { ok: false, text: "This pair couldn't be added to your cart. You may already have the maximum quantity, or this size is unavailable." }
    );
  };

  return (
    <li className="wishlist-item" aria-labelledby={titleId}>
      <div className="wishlist-item-media">
        <img src={getProductImage(product)} alt={product.name} loading="lazy" onError={useFallbackProductImage} />
      </div>
      <div className="wishlist-item-body">
        <p className="wishlist-item-category">{formatProductCategory(product)}</p>
        <h2 className="wishlist-item-title" id={titleId}>
          <Link to={`/details/${product._id}`}>{product.name}</Link>
        </h2>
        <div className="wishlist-item-meta">
          {price && <p className="wishlist-item-price">{price}</p>}
          <p className={`wishlist-item-stock ${soldOut ? "is-sold-out" : ""}`.trim()}>{getAvailabilityLabel(product)}</p>
        </div>

        {soldOut ? (
          <p className="wishlist-item-note">This pair is sold out. Keep it saved to check back later.</p>
        ) : sizes.length ? (
          <div className="wishlist-sizes">
            <p id={sizeGroupId}>Choose a UK size</p>
            <ul aria-labelledby={sizeGroupId}>
              {sizes.map((size) => (
                <li key={size}>
                  <button type="button" aria-pressed={selectedSize === size} onClick={() => { setSelectedSize(size); setFeedback(null); }}>
                    {size}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="wishlist-item-note">Size information is unavailable, so this pair can't be added to your cart yet.</p>
        )}

        <div className="wishlist-item-actions">
          <button type="button" className="wishlist-cart-button" onClick={handleAdd} disabled={soldOut || !selectedSize}>
            {soldOut ? "Currently unavailable" : "Add to cart"}
          </button>
          <RemoveButton name={product.name} onRemove={() => onRemove(product.name)} />
        </div>
        <p className={`wishlist-feedback ${feedback && !feedback.ok ? "is-error" : ""}`.trim()} role="status">
          {feedback?.text}
          {feedback?.ok && <> <Link to="/cart">View cart</Link></>}
        </p>
      </div>
    </li>
  );
};

const WishlistItem = ({ item, position, onRemove, onRetry }) => {
  if (item.status === "loading") return <LoadingItem />;
  if (item.status === "ready") return <ReadyItem product={item.product} onRemove={onRemove} />;
  return <UnavailableItem id={item.id} status={item.status} position={position} onRemove={onRemove} onRetry={onRetry} />;
};

export default WishlistItem;
