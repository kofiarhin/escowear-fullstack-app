import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import "./home.styles.css";
import Product from "../../components/Product/Product.component";
import HeroCarousel from "../../components/HeroCarousel/HeroCarousel.component";
import { getProducts } from "../../redux/actions/products.actions";
import { brandLinks, howSteps } from "./homeContent";
import useFeaturedSneakers, { FEATURED_LIMIT } from "./useFeaturedSneakers";
import BrandLogo from "./BrandLogo";
import useHomepageClassics, { CLASSICS_LIMIT } from "./useHomepageClassics";
import useLatestReleases, { LATEST_DEFAULT_COUNT } from "./useLatestReleases";
import { getProductImage } from "../../utils/product";

// The first catalogue page only supplies the Featured "pairs in the catalogue"
// count; Featured, Classics and Latest Releases each load their own selection.
const HOME_PRODUCT_QUERY = { limit: 4, page: 1 };

const ArrowIcon = () => (
  <svg className="home-arrow" viewBox="0 0 18 18" aria-hidden="true">
    <path d="M2 9h13M10 4l5 5-5 5" />
  </svg>
);

const formatCount = (value) => new Intl.NumberFormat("en-GB").format(value);
const padIndex = (index) => String(index + 1).padStart(2, "0");
const storeSearchPath = (term) => `/store?search=${encodeURIComponent(term)}`;

const handleClassicImageError = ({ currentTarget: image }) => {
  if (image.getAttribute("src") === "/images/default.jpg") {
    image.style.visibility = "hidden";
  } else {
    image.src = "/images/default.jpg";
  }
};

const ProductSkeletons = ({ label, className, count }) => (
  <div className={className} role="status" aria-label={label} aria-busy="true">
    {Array.from({ length: count }, (_, item) => (
      <div className="home-skeleton" key={item} aria-hidden="true">
        <span></span><i></i><i></i>
      </div>
    ))}
  </div>
);

const Home = () => {
  const dispatch = useDispatch();
  const { status, pagination } = useSelector(
    (state) => state.productsReducer
  );

  const featured = useFeaturedSneakers();
  const classics = useHomepageClassics();
  const latest = useLatestReleases();

  useEffect(() => {
    dispatch(getProducts(HOME_PRODUCT_QUERY));
  }, [dispatch]);

  // Store and Home share products state; only trust a total fetched with the homepage query.
  const catalogueTotal =
    status === "success" && pagination?.limit === HOME_PRODUCT_QUERY.limit
      ? pagination.total || 0
      : 0;

  const renderProducts = (items, { request, label, className, emptyCopy, skeletons }) => {
    if (request.status === "pending" || request.status === "idle") {
      return <ProductSkeletons label={label} className={className} count={skeletons} />;
    }

    if (request.status === "failed") {
      return (
        <div className="home-message" role="alert">
          <p>We couldn't load the sneaker edit.</p>
          <button type="button" onClick={request.retry}>
            Try again
          </button>
          {request.error && <span>{request.error}</span>}
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="home-message">
          <p>{emptyCopy}</p>
          <Link to="/store">Browse all sneakers</Link>
        </div>
      );
    }

    return (
      <div className={className}>
        {items.map((product, index) => (
          <Product data={product} key={product._id} index={index} />
        ))}
      </div>
    );
  };

  return (
    <main className="home">
      <HeroCarousel />

      <section className="home-brands" id="collections" aria-labelledby="brands-title">
        <div className="home-brands__intro container">
          <p className="home-eyebrow">Collections</p>
          <h2 id="brands-title">Shop by brand</h2>
          <Link to="/store" className="home-link">View the full catalogue</Link>
        </div>
        <ul className="home-brands__list">
          {brandLinks.map((brand) => (
            <li key={brand.name}>
              <Link to={brand.to}>
                <BrandLogo brand={brand} />
                <strong>{brand.name}</strong>
                <ArrowIcon />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="home-featured home-section container" aria-labelledby="featured-title">
        <header className="home-heading">
          <div>
            <p className="home-eyebrow">The current rotation</p>
            <h2 id="featured-title">Featured sneakers</h2>
          </div>
          <div className="home-heading__aside">
            {catalogueTotal > 0 && (
              <p className="home-heading__meta">
                <strong>{formatCount(catalogueTotal)}</strong> pairs in the catalogue
              </p>
            )}
            <Link to="/store" className="home-button home-button--dark">
              Shop all sneakers <ArrowIcon />
            </Link>
          </div>
        </header>
        {renderProducts(featured.items, {
          request: featured,
          label: "Loading featured sneakers",
          className: "home-featured__grid",
          skeletons: FEATURED_LIMIT,
          emptyCopy: "No sneakers are available in this edit yet.",
        })}
      </section>

      <section className="home-classics" id="classics" aria-labelledby="classics-title">
        <div className="home-classics__inner container">
          <header className="home-classics__header">
            <div className="home-classics__intro">
              <p className="home-eyebrow">Icons, always in rotation</p>
              <h2 id="classics-title">The Classics</h2>
              <p className="home-classics__lede">
                Court staples and terrace icons from Nike and adidas.
              </p>
            </div>
            {/* Cards are admin-chosen across brands, so the section CTA opens the full
                store; the empty state carries its own link instead. */}
            {(classics.status === "pending" || classics.items.length > 0) && (
              <Link to="/store" className="home-button home-button--light">
                Shop the classics <ArrowIcon />
              </Link>
            )}
          </header>

          {classics.status === "pending" && (
            <div className="home-classics__grid" role="status" aria-label="Loading the classics" aria-busy="true">
              {Array.from({ length: CLASSICS_LIMIT }, (_, item) => (
                <div className="home-classics__card" key={item} aria-hidden="true">
                  <span className="home-classics__image"><span className="home-classics__loading" /></span>
                  <span className="home-classics__caption" />
                </div>
              ))}
            </div>
          )}
          {classics.status !== "pending" && classics.items.length === 0 && (
            <div className="home-message">
              <p>New classics are on the way.</p>
              <Link to="/store">Browse all sneakers</Link>
            </div>
          )}
          {classics.items.length > 0 && (
            <nav aria-label="Shop classic silhouettes">
              <ol className="home-classics__grid">
                {classics.items.map((classic, index) => (
                  <li key={`${index}-${classic.product?._id || classic.searchTerm}`}>
                    <Link to={storeSearchPath(classic.searchTerm)} className="home-classics__card" aria-labelledby={`classic-${index}`}>
                      <span className="home-classics__image">
                        <img
                          src={getProductImage(classic.product || {})}
                          alt={classic.product?.name || `${classic.title} sneaker`}
                          loading="lazy"
                          decoding="async"
                          onError={handleClassicImageError}
                        />
                      </span>
                      <span className="home-classics__caption">
                        <span className="home-classics__name" id={`classic-${index}`}>{classic.title}</span>
                        <ArrowIcon />
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </div>
      </section>

      <section className="home-latest home-section container" id="latest-releases" aria-labelledby="latest-title">
        <header className="home-heading">
          <div>
            <p className="home-eyebrow">Fresh to the edit</p>
            <h2 id="latest-title">Latest releases</h2>
          </div>
          <div className="home-heading__aside">
            {latest.status === "success" && (
              <p className="home-heading__meta">
                {latest.configured ? "Hand-picked from the Escowear catalogue" : "Pulled directly from the Escowear catalogue"}
              </p>
            )}
            <Link to="/store" className="home-link">See every release</Link>
          </div>
        </header>
        {renderProducts(latest.items, {
          request: latest,
          label: "Loading latest releases",
          className: "home-latest__grid",
          skeletons: LATEST_DEFAULT_COUNT,
          emptyCopy: "New releases are on the way.",
        })}
      </section>

      <section className="home-how" id="how-it-works" aria-labelledby="how-title">
        <div className="home-how__inner container">
          <div className="home-how__intro">
            <p className="home-eyebrow">From the UK to your doorstep</p>
            <h2 id="how-title">How Escowear works</h2>
            <p className="home-how__note">
              Items are sourced after payment; UK retailer stock is subject to availability.
            </p>
            <Link to="/store" className="home-button home-button--dark">
              Explore sneakers <ArrowIcon />
            </Link>
          </div>
          <ol className="home-how__steps">
            {howSteps.map((step, index) => (
              <li key={step.title}>
                <span aria-hidden="true">{padIndex(index)}</span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="home-about" id="about" aria-labelledby="about-title">
        <div className="home-about__inner container">
          <p className="home-eyebrow">About Escowear</p>
          <h2 id="about-title">Authentic UK sneakers. Delivered to Ghana.</h2>
          <div className="home-about__body">
            <p>
              Choose your pair from our UK retailer selection, pay Escowear in GHS,
              and we handle purchasing, shipping and delivery in Ghana.
            </p>
            <Link to="/store" className="home-link">Enter the store</Link>
          </div>
        </div>
      </section>
    </main>
  );
};

export default Home;
