import "./search.styles.css";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

// search component
const Search = ({ onSearch }) => {
  const [search, setSearch] = useState("");

  const navigate = useNavigate();

  const handleChange = (e) => {
    setSearch(e.target.value);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch(search);
  };
  return (
    <div className="search">
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Search Product"
          value={search}
          onChange={(e) => handleChange(e)}
        />
      </form>
    </div>
  );
};

export default Search;
