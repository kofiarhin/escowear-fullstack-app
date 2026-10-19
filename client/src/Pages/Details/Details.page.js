import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  formatProductCategory,
  formatProductPrice,
  formatProductSize,
  getAvailabilityLabel,
  getProductImage,
  useFallbackProductImage,
} from "../../utils/product";
import "./details.styles.css";
import { addCartItem, readCart, saveCart, MAX_CART_QUANTITY } from "../../utils/cart";

const Details = () => {
  const [product, setProduct] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [selectedImage, setSelectedImage] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [quantity, setQuantity] = useState(1);
  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError("");

    fetch(`/api/products/${id}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Product request failed");
        }
        return response.json();
      })
      .then((data) => {
        setProduct(data);
        setSelectedSize("");
        setQuantity(1);
        setSelectedImage(getProductImage(data));
        setStatus("success");
      })
      .catch((requestError) => {
        if (requestError.name === "AbortError") return;
        setError(requestError.message);
        setStatus("failed");
      });

    return () => controller.abort();
  }, [id]);

  const images = useMemo(() => {
    if (!product) return [];
    return [...new Set([product.image, ...(product.images || [])].filter(Boolean))];
  }, [product]);

  const addToCart = () => {
    if (!selectedSize) return;
    const updated = addCartItem(readCart(), product, selectedSize, quantity);
    saveCart(updated);
    navigate("/cart");
  };

  if (status === "loading") {
    return (
      <main className="details-state container" aria-live="polite">
        <span className="details-state-line" aria-hidden="true"></span>
        <p>Loading sneaker details</p>
      </main>
    );
  }

  if (status === "failed" || !product) {
    return (
      <main className="details-state container" role="alert">
        <p>We couldn't load this sneaker.</p>
        {error && <span>{error}</span>}
        <Link to="/store?category=shoes">Return to the store</Link>
      </main>
    );
  }

  const formattedPrice = formatProductPrice(product);
  const retailerName = product.retailer?.name || "the retailer";
  const sizes = (product.sizes || []).map(formatProductSize).filter(Boolean);

  return (
    <main className="details container">
      <Link className="details-back" to="/store?category=shoes">
        Back to sneakers
      </Link>

      <div className="details-layout">
        <section className="details-media" aria-label="Product images">
          <div className="details-main-image">
            <img
              src={selectedImage || getProductImage(product)}
              alt={product.name}
              onError={useFallbackProductImage}
            />
          </div>
          {images.length > 1 && (
            <div className="details-thumbnails" aria-label="Choose product image">
              {images.slice(0, 5).map((image) => (
                <button
                  type="button"
                  className={selectedImage === image ? "is-active" : ""}
                  aria-label={`View ${product.name}`}
                  aria-pressed={selectedImage === image}
                  onClick={() => setSelectedImage(image)}
                  key={image}
                >
                  <img src={image} alt="" onError={useFallbackProductImage} />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="details-copy">
          <div className="details-meta">
            <span>{formatProductCategory(product)}</span>
            <span className={product.inStock === false ? "is-sold-out" : ""}>
              {getAvailabilityLabel(product)}
            </span>
          </div>
          <h1 className="product-name">{product.name}</h1>
          {product.brand && <p className="details-brand">{product.brand}</p>}
          {formattedPrice && <p className="product-price">{formattedPrice}</p>}

          <div className="details-sizes">
            <div>
              <h2>Available sizes</h2>
              <span>UK sizing</span>
            </div>
            {sizes.length ? (
              <ul>
                {sizes.map((size) => <li key={size}><button type="button" aria-pressed={selectedSize === size} onClick={() => setSelectedSize(size)}>{size}</button></li>)}
              </ul>
            ) : (
              <p>Size information is unavailable for this product.</p>
            )}
          </div>

          <label htmlFor="details-quantity">Quantity</label>
          <input id="details-quantity" type="number" min="1" max={MAX_CART_QUANTITY} value={quantity} onChange={event => setQuantity(Number(event.target.value))} />
          <button
            className="details-cart-button"
            type="button"
            onClick={addToCart}
            disabled={product.inStock === false || !selectedSize || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY}
          >
            {product.inStock === false ? "Currently unavailable" : "Add to cart"}
          </button>

          {product.productUrl && (
            <a
              className="details-retailer-link"
              href={product.productUrl}
              target="_blank"
              rel="noreferrer"
            >
              View at {retailerName}
            </a>
          )}
        </section>
      </div>
    </main>
  );
};

export default Details;
