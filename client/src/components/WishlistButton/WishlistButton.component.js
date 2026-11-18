import { useState } from "react";
import useWishlist from "./useWishlist";
import "./wishlistButton.styles.css";

export const HeartIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" />
  </svg>
);

const MESSAGES = {
  added: (name) => `${name} saved to your wishlist`,
  removed: (name) => `${name} removed from your wishlist`,
  full: () => "Your wishlist is full. Remove a pair to save another.",
  failed: () => "We couldn't update your wishlist on this device.",
};

const WishlistButton = ({ productId, productName = "this sneaker", className = "" }) => {
  const { has, toggle } = useWishlist();
  const [message, setMessage] = useState("");
  const saved = has(productId);

  return (
    <>
      <button
        type="button"
        className={`wishlist-button ${saved ? "is-saved" : ""} ${className}`.replace(/\s+/g, " ").trim()}
        aria-label={saved ? `Remove ${productName} from wishlist` : `Save ${productName} to wishlist`}
        onClick={() => setMessage(MESSAGES[toggle(productId)](productName))}
      >
        <HeartIcon />
      </button>
      <span className="wishlist-sr-only" role="status">{message}</span>
    </>
  );
};

export default WishlistButton;
