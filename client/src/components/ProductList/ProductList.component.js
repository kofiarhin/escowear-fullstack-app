import Product from "../Product/Product.component";
const ProductList = ({ data }) => {
  return (
    <div className="container">
      <div className="wrapper">
        {data.map((item) => (
          <Product data={item} key={item._id} />
        ))}
      </div>
    </div>
  );
};

export default ProductList;
