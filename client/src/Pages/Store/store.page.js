import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import ProductList from "../../components/ProductList/ProductList.component";
import { getProducts } from "../../redux/actions/products.actions";
import { setSearchField } from "../../redux/actions/search.action";
import "./store.styles.css";

const filters = [
  { label: "All Sneakers", value: "" },
  { label: "Air Jordan", value: "air jordan" },
  { label: "Nike", value: "nike" },
  { label: "Adidas", value: "adidas" },
  { label: "New Balance", value: "new balance" },
  { label: "Yeezy", value: "yeezy" },
];

const Store = () => {
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSearch = searchParams.get("search") || "";
  const requestedCategory = (searchParams.get("category") || "").toLowerCase() === "shoes"
    ? ""
    : searchParams.get("category") || "";
  const requestedPage = Math.max(1, Number(searchParams.get("page")) || 1);
  const { products, status, error, pagination } = useSelector(
    (state) => state.productsReducer
  );
  const { searchField } = useSelector((state) => state.searchReducer);

  useEffect(() => {
    dispatch(
      getProducts({
        category: requestedCategory,
        search: requestedSearch,
        limit: 24,
        page: requestedPage,
      })
    );
  }, [dispatch, requestedCategory, requestedPage, requestedSearch]);

  useEffect(() => {
    dispatch(setSearchField(requestedSearch));
  }, [dispatch, requestedSearch]);

  const normalizedSearch = searchField.trim().toLowerCase();

  const handleFilter = (value) => {
    dispatch(setSearchField(value));
    setSearchParams(
      value
        ? { search: value, page: "1" }
        : { page: "1" }
    );
  };

  const handlePage = (page) => {
    const nextParams = new URLSearchParams(searchParams);
    if (requestedCategory) nextParams.set("category", requestedCategory);
    else nextParams.delete("category");
    nextParams.set("page", String(page));
    setSearchParams(nextParams);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const retryProducts = () =>
    dispatch(
      getProducts({
        category: requestedCategory,
        search: requestedSearch,
        limit: 24,
        page: requestedPage,
      })
    );

  const title = normalizedSearch ? `Sneakers / ${searchField}` : "All sneakers";

  return (
    <main className="store">
      <div className="store-heading container">
        <p>Escowear sneaker catalogue</p>
        <h1 className="title">{title}</h1>
        {status === "success" && (
          <span className="store-count">
            {pagination.total.toLocaleString("en-GB")} sneakers
          </span>
        )}
      </div>

      <div className="categories" aria-label="Filter sneakers">
        {filters.map((filter) => (
          <button
            type="button"
            className={normalizedSearch === filter.value ? "is-active" : ""}
            aria-pressed={normalizedSearch === filter.value}
            onClick={() => handleFilter(filter.value)}
            key={filter.label}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {status === "pending" || status === "idle" ? (
        <div className="store-state container" aria-live="polite">
          Loading sneakers
        </div>
      ) : status === "failed" ? (
        <div className="store-state container" role="alert">
          <p>We couldn't load the sneaker catalogue.</p>
          {error && <span>{error}</span>}
          <button type="button" onClick={retryProducts}>Try again</button>
        </div>
      ) : products.length === 0 ? (
        <div className="store-state container">
          <p>No sneakers matched “{searchField}”.</p>
          <button type="button" onClick={() => handleFilter("")}>View all sneakers</button>
        </div>
      ) : (
        <>
          <ProductList data={products} />
          {pagination.pages > 1 && (
            <nav className="store-pagination container" aria-label="Product pages">
              <button
                type="button"
                onClick={() => handlePage(pagination.page - 1)}
                disabled={pagination.page <= 1}
              >
                Previous
              </button>
              <span>Page {pagination.page} of {pagination.pages}</span>
              <button
                type="button"
                onClick={() => handlePage(pagination.page + 1)}
                disabled={pagination.page >= pagination.pages}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </main>
  );
};

export default Store;
