import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import useWishlist from "../../components/WishlistButton/useWishlist";
import useWishlistProducts from "./useWishlistProducts";
import WishlistItem from "./WishlistItem.component";
import "./wishlist.styles.css";

const Wishlist = () => {
  const { ids, count, remove } = useWishlist();
  const { items, retry } = useWishlistProducts(ids);
  const [notice, setNotice] = useState(null);
  const headingRef = useRef(null);
  const focusHeading = useRef(false);
  const loading = items.some((item) => item.status === "loading");

  // Removing an item unmounts the focused Remove button, so focus moves to the
  // page heading (in the list or the empty state) instead of falling to <body>.
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    headingRef.current?.focus();
  }, [count]);

  const removeItem = (id, name) => {
    if (!remove(id)) {
      setNotice({ ok: false, text: "We couldn't update your wishlist on this device." });
      return;
    }
    focusHeading.current = true;
    setNotice({ ok: true, text: `${name} removed from your wishlist.` });
  };

  // Rendered first in both layouts so React keeps one live region when the
  // last removal swaps the list for the empty state, and the message is announced.
  const status = (
    <p className={`wishlist-notice ${notice && !notice.ok ? "is-error" : ""}`.trim()} role="status">
      {notice?.text}
    </p>
  );

  if (!count) {
    return (
      <main className="wishlist container">
        {status}
        <section className="wishlist-empty">
          <p className="wishlist-eyebrow">Your wishlist</p>
          <h1 ref={headingRef} tabIndex={-1}>Your wishlist is empty</h1>
          <p className="wishlist-empty-copy">Tap the heart on any sneaker to save it here for later.</p>
          <Link className="wishlist-shop-link" to="/store?category=shoes">Browse sneakers</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="wishlist container">
      {status}
      <header className="wishlist-header">
        <div>
          <p className="wishlist-eyebrow">{count} saved {count === 1 ? "pair" : "pairs"}</p>
          <h1 className="title" ref={headingRef} tabIndex={-1}>Wishlist</h1>
        </div>
        <Link className="wishlist-continue" to="/store?category=shoes">Continue shopping</Link>
      </header>
      {loading && <p className="wishlist-loading" role="status">Loading your saved sneakers…</p>}
      <ul className="wishlist-items">
        {items.map((item, index) => (
          <WishlistItem
            item={item}
            key={item.id}
            position={index + 1}
            onRemove={(name) => removeItem(item.id, name)}
            onRetry={retry}
          />
        ))}
      </ul>
    </main>
  );
};

export default Wishlist;
