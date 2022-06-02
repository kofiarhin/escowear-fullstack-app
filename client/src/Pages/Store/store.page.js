import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ProductList from "../../components/ProductList/ProductList.component";
const Store = () => {
  const [data, setData] = useState([]);

  const { category } = useParams();

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
