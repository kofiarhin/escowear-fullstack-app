import { useEffect, useState } from "react";
import "./store.styles.css";
import { useParams } from "react-router-dom";
import ProductList from "../../components/ProductList/ProductList.component";
const Store = ({ category, setCategory }) => {
  const [data, setData] = useState([]);

  useEffect(() => {
    fetch("/api/products")
      .then((response) => response.json())
      .then((data) => setData(data));
  }, []);

  return (
    <div className="store">
      <div className="categories">
        <button onClick={() => setCategory("hoodies")}>Hoodies</button>
        <button onClick={() => setCategory("shirts")}>shirts</button>
        <button onClick={() => setCategory("gym")}>Gym</button>
      </div>
      <ProductList data={data} category={category} />
    </div>
  );
};

export default Store;
