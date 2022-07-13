import { useEffect, useState } from "react";
import "./store.styles.css";
import { useParams } from "react-router-dom";
import ProductList from "../../components/ProductList/ProductList.component";
import { getProducts } from "../../redux/actions/products.actions";
import { useDispatch, useSelector } from "react-redux";
import { setSearchField } from "../../redux/actions/search.action";

// store component
const Store = () => {
  const dispatch = useDispatch();
  const [category, setCategory] = useState("hoodies");
  const { isPending, products } = useSelector((state) => state.productsReducer);
  const { searchField } = useSelector((state) => state.searchReducer);

  useEffect(() => {
    dispatch(getProducts());
  }, []);

  let filteredData;

  if (searchField) {
    filteredData = products.filter((item) =>
      item.name.toLowerCase().includes(searchField)
    );
  } else {
    filteredData = products.filter((item) => item.category === category);
  }

  const handleCategory = (category) => {
    setCategory(category);
    dispatch(setSearchField(""));
  };

  return (
    <div className="store">
      <div className="categories">
        <button onClick={() => handleCategory("hoodies")}>Hoodies</button>
        <button onClick={() => handleCategory("shirts")}>shirts</button>
        <button onClick={() => handleCategory("gym")}>Gym</button>
      </div>

      <h1 className="title">
        {" "}
        {searchField ? `Search Result for: ${searchField}` : category}{" "}
      </h1>
      <ProductList data={filteredData} category={category} />
    </div>
  );
};

export default Store;
