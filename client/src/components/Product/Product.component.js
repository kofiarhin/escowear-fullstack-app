import { Link } from "react-router-dom";
import "./product.styles.css";
import {
  formatProductCategory,
  formatProductPrice,
  getAvailabilityLabel,
  getProductImage,
  useFallbackProductImage,
} from "../../utils/product";
import WishlistButton from "../WishlistButton/WishlistButton.component";

const Product = ({ data, index }) => {
  const { name, color, colors, _id, inStock } = data;
  const colourLabel = Array.isArray(colors) && colors.length ? colors.join(", ") : color;

  const imgUrl = getProductImage(data);
  const imageAlt =
    colourLabel && !name.toLowerCase().includes(colourLabel.toLowerCase())
      ? `${name} in ${colourLabel}`
      : name;
  const formattedPrice = formatProductPrice(data);

  return (
    // The heart sits beside the link, not inside it: interactive content may not nest in <a>.
    <article className="product" style={{ "--product-index": index ?? 0 }}>
      <Link to={`/details/${_id}`} className="product-link">
        <div className="product-image-wrap">
          <img
            src={imgUrl}
            alt={imageAlt}
            loading="lazy"
            decoding="async"
            onError={useFallbackProductImage}
          />
          <span className={`product-stock ${inStock === false ? "is-sold-out" : ""}`}>
            {getAvailabilityLabel(data)}
          </span>
          <span className="product-view">View sneaker</span>
        </div>
        <div className="product-details">
          <div>
            <p className="product-category">{formatProductCategory(data)}</p>
            <h3 className="name">{name}</h3>
          </div>
          {formattedPrice && <p className="price">{formattedPrice}</p>}
        </div>
      </Link>
      <WishlistButton productId={_id} productName={name} className="product-wishlist" />
    </article>
  );
};

export default Product;
