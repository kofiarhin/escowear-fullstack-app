import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./details.styles.css";
// details
const Details = () => {
  const [product, setProduct] = useState();
  const { id } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    fetch(`/api/products/${id}`)
      .then((response) => response.json())
      .then((data) => setProduct(data));
  }, []);

  let imgUrl = "";
  if (product) {
    const { category, name, _id, price } = product;
    imgUrl = `/images/${category}/${name}/1.jpg`;
  }

  const addToCart = (data) => {
    // get cart details
    let cartData = sessionStorage.getItem("cartData");

    if (!cartData) {
      cartData = [data];
      sessionStorage.setItem("cartData", JSON.stringify(cartData));
      navigate("/cart");
    } else {
      let parsedData = JSON.parse(sessionStorage.getItem("cartData"));
      parsedData = [data, ...parsedData];
      sessionStorage.setItem("cartData", JSON.stringify(parsedData));
      navigate("/cart");
    }
  };
  return (
    <div>
      {product ? (
        <div className="details">
          <img src={imgUrl} alt="" />
          <h1 className="product-name"> {product.name} </h1>
          <h2 className="product-price"> ${product.price.toFixed(2)} </h2>
          <button onClick={() => addToCart(product)}>Add To Cart</button>
        </div>
      ) : null}
    </div>
  );
};

export default Details;
