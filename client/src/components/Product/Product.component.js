import { Link } from "react-router-dom";
import "./product.styles.css";
import {
  formatProductCategory,
  formatProductPrice,
  getAvailabilityLabel,
  getProductImage,
  useFallbackProductImage,
} from "../../utils/product";

const Product = ({ data, index }) => {
  const { name, color, _id, inStock } = data;

  const imgUrl = getProductImage(data);
  const imageAlt =
    color && !name.toLowerCase().includes(color.toLowerCase())
      ? `${name} in ${color}`
      : name;
  const formattedPrice = formatProductPrice(data);

  return (
    <Link
      to={`/details/${_id}`}
      className="product"
      style={{ "--product-index": index ?? 0 }}
    >
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
  );
};

export default Product;
