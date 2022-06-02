import Product from "../Product/Product.component";
const ProductList = ({ data, category = "hoodies" }) => {
  const filtered = data.filter((item) => item.category === category);

  return (
    <div className="container">
      <h1 className="title"> {category} </h1>

      <div className="wrapper">
        {filtered.map((item) => (
          <Product data={item} key={item._id} />
        ))}
      </div>
    </div>
  );
};

export default ProductList;
