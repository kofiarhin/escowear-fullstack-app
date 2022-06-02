import { Link } from "react-router-dom";
import "./product.styles.css";
const Product = ({ data }) => {
  const { name, price, sizes, category, _id } = data;

  const imgUrl = `/images/${category}/${name}/1.jpg`;

  return (
    <Link to={`/details/${_id}`} className="product">
      <img src={imgUrl} alt="" />
      <h1 className="name"> {name} </h1>
      <h2 className="price"> ${price}.00 </h2>
    </Link>
  );
};

export default Product;
