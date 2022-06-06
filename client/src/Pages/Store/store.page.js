import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ProductList from "../../components/ProductList/ProductList.component";
const Store = ({ category }) => {
  const [data, setData] = useState([]);

  useEffect(() => {
    fetch("/api/products")
      .then((response) => response.json())
      .then((data) => setData(data));
  }, []);

  return (
    <div>
      <ProductList data={data} category={category} />
    </div>
  );
};

export default Store;
