import Product from "../Product/Product.component";
const ProductList = ({ data }) => {
  return (
    <div className="container">
      <div className="wrapper">
        {data.map((item, index) => (
          <Product data={item} key={item._id} index={index} />
        ))}
      </div>
    </div>
  );
};

export default ProductList;
