import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import "./home.styles.css";
import Product from "../../components/Product/Product.component";
import { getProducts } from "../../redux/actions/products.actions";

const categories = [
  { name: "New Releases", to: "/#latest-releases", number: "01" },
  { name: "Air Jordan", to: "/store?search=air%20jordan", number: "02" },
  { name: "Nike", to: "/store?search=nike", number: "03" },
  { name: "Adidas", to: "/store?search=adidas", number: "04" },
  { name: "New Balance", to: "/store?search=new%20balance", number: "05" },
  { name: "Yeezy", to: "/store?search=yeezy", number: "06" },
];

const ArrowIcon = () => (
  <svg className="arrow-icon" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M2 9h13M10 4l5 5-5 5" />
  </svg>
);

const ProductSkeletons = ({ label }) => (
  <div className="home-product-grid" aria-label={label}>
    {[0, 1, 2, 3].map((item) => (
      <div className="product-skeleton" key={item} aria-hidden="true">
        <span></span><i></i><i></i>
      </div>
    ))}
  </div>
);

const Home = () => {
  const dispatch = useDispatch();
  const { products, status, error } = useSelector(
    (state) => state.productsReducer
  );

  useEffect(() => {
    dispatch(getProducts({ limit: 8, page: 1 }));
  }, [dispatch]);

  const sneakers = products;
  const featuredSneakers = sneakers.slice(0, 4);
  const latestSneakers = sneakers.slice(4, 8);

  const renderProducts = (items, loadingLabel) => {
    if (status === "pending" || status === "idle") {
      return <ProductSkeletons label={loadingLabel} />;
    }

    if (status === "failed") {
      return (
        <div className="products-message" role="alert">
          <p>We couldn't load the sneaker edit.</p>
          <button
            type="button"
            onClick={() => dispatch(getProducts({ limit: 8, page: 1 }))}
          >
            Try again
          </button>
          {error && <span>{error}</span>}
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="products-message">
          <p>No sneakers are available in this edit yet.</p>
          <Link to="/store">Browse all sneakers</Link>
        </div>
      );
    }

    return (
      <div className="home-product-grid">
        {items.map((product, index) => (
          <Product data={product} key={product._id} index={index} />
        ))}
      </div>
    );
  };

  return (
    <main className="home">
      <section className="sneaker-hero" aria-labelledby="hero-title">
        <div className="hero-grid-lines" aria-hidden="true"></div>
        <div className="sneaker-hero-copy">
          <p className="eyebrow">Escowear / UK sneakers to Ghana</p>
          <h1 id="hero-title">
            <span>UK sneakers</span>
            <span>to Ghana</span>
          </h1>
          <div className="hero-lower">
            <p>
              Shop authentic sneakers from trusted UK retailers. Pay in Ghana cedis; we buy your pair in the UK and deliver it to Ghana.
            </p>
            <Link to="/store" className="button button-dark">
              Shop Sneakers <ArrowIcon />
            </Link>
          </div>
        </div>

        <div className="sneaker-hero-media">
          <span className="hero-vertical-copy">Sourced in the UK / Delivered to Ghana</span>
          <img
            src="/images/shoes/SUPREME X NIKE AIR FORCE 1 LOW 'BOX LOGO - BLACK'/1.jpg"
            alt="Supreme x Nike Air Force 1 Low in black"
          />
          <div className="hero-shoe-label">
            <span>Featured silhouette</span>
            <strong>Nike Air Force 1</strong>
          </div>
        </div>
      </section>

      <section className="category-rail" id="collections" aria-label="Shop sneaker categories">
        {categories.map((category) => (
          <Link to={category.to} key={category.name}>
            <span>{category.number}</span>
            <strong>{category.name}</strong>
            <ArrowIcon />
          </Link>
        ))}
      </section>

      <section className="featured section container" aria-labelledby="featured-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">The current rotation</p>
            <h2 id="featured-title">Featured sneakers</h2>
          </div>
          <Link to="/store" className="text-link">Shop all sneakers</Link>
        </div>
        {renderProducts(featuredSneakers, "Loading featured sneakers")}
      </section>

      <section className="classics" aria-labelledby="classics-title">
        <div className="classics-copy">
          <p className="eyebrow">Icons, always in rotation</p>
          <h2 id="classics-title">The<br />Classics</h2>
          <p>
            The pairs that set the pace. Explore defining basketball shapes,
            court staples and enduring Nike design.
          </p>
          <Link to="/store?search=nike" className="button button-light">
            Shop the classics <ArrowIcon />
          </Link>
        </div>
        <div className="classics-gallery">
          <figure className="classic-frame classic-frame-main">
            <img
              src="/images/shoes/NIKE DUNK HIGH SP 'MICHIGAN' 2020/1.jpg"
              alt="Nike Dunk High Michigan 2020"
            />
            <figcaption>Nike Dunk High / Michigan</figcaption>
          </figure>
          <figure className="classic-frame classic-frame-small">
            <img
              src="/images/shoes/AIR JORDAN 1 MID PS BANNED/1.jpg"
              alt="Air Jordan 1 Mid PS Banned"
            />
            <figcaption>Air Jordan 1 / Banned</figcaption>
          </figure>
        </div>
      </section>

      <section className="latest section container" id="latest-releases" aria-labelledby="latest-title">
        <div className="section-heading latest-heading">
          <div>
            <p className="eyebrow">Fresh to the edit</p>
            <h2 id="latest-title">Latest releases</h2>
          </div>
          <p className="release-note">Pulled directly from the Escowear catalogue</p>
        </div>
        {renderProducts(latestSneakers, "Loading latest releases")}
      </section>

      <section className="how-it-works section container" id="how-it-works" aria-labelledby="how-title">
        <p className="eyebrow">From the UK to your doorstep</p>
        <h2 id="how-title">How Escowear works</h2>
        <div className="how-steps">
          <article><span>01</span><h3>Browse</h3><p>Choose authentic sneakers from our curated UK retailer selection.</p></article>
          <article><span>02</span><h3>Pay in GHS</h3><p>See your total before checkout and pay Escowear in Ghana cedis.</p></article>
          <article><span>03</span><h3>We buy in the UK</h3><p>After payment, we confirm availability and purchase your pair from a trusted retailer.</p></article>
          <article><span>04</span><h3>Delivered in Ghana</h3><p>We arrange shipping and keep you updated until delivery.</p></article>
        </div>
        <p className="how-note">Items are sourced after payment; UK retailer stock is subject to availability.</p>
        <Link to="/store" className="button button-dark">Explore sneakers <ArrowIcon /></Link>
      </section>

      <section className="about-strip" id="about" aria-labelledby="about-title">
        <p className="eyebrow">About Escowear</p>
        <h2 id="about-title">Authentic UK sneakers.<br />Delivered to Ghana.</h2>
        <p className="about-copy">
          Choose your pair from our UK retailer selection, pay Escowear in GHS, and we handle purchasing, shipping and delivery in Ghana.
        </p>
        <Link to="/store" className="text-link">Enter the store</Link>
      </section>
    </main>
  );
};

export default Home;
