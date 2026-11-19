import { getProductImage, useFallbackProductImage } from "../../utils/product";
import { SEARCH_TERM_MAX, TITLE_MAX, cardErrors, productName, storePath } from "./classicsEditor";

const WARNING_COPY = {
  draft: "This product is a draft, so this card is hidden from the homepage. Change the product or remove the card.",
  missing: "This product no longer exists, so this card is hidden from the homepage. Change the product or remove the card.",
  unavailable: "This product is no longer available. Change the product or remove the card.",
};

// One editable homepage card: copy fields, its representative product and ordering controls.
const ClassicCardEditor = ({ card, index, count, choosing, onChange, onChooseProduct, onMove, onRemove }) => {
  const number = index + 1;
  const errors = cardErrors(card);
  const fieldId = (name) => `${card.key}-${name}`;
  const errorProps = (name) => (errors[name] ? { "aria-invalid": true, "aria-describedby": fieldId(`${name}-error`) } : {});
  const productLabel = card.product ? productName(card.product) : card.productId ? `Missing product ${card.productId}` : "No product chosen";

  return (
    <li className={`featured-admin__slot classics-admin__card${choosing ? " is-choosing" : ""}`}>
      <span className="featured-admin__position" aria-hidden="true">{number}</span>
      {card.product ? <img src={getProductImage(card.product)} alt="" onError={useFallbackProductImage} /> : <span className="featured-admin__placeholder" aria-hidden="true">?</span>}
      <div className="featured-admin__details classics-admin__fields">
        <div className="admin-field">
          <label htmlFor={fieldId("title")}>Card {number} title</label>
          <input id={fieldId("title")} value={card.title} maxLength={TITLE_MAX} onChange={(event) => onChange({ title: event.target.value })} {...errorProps("title")} />
          {errors.title && <span className="admin-error" id={fieldId("title-error")}>{errors.title}</span>}
        </div>
        <div className="admin-field">
          <label htmlFor={fieldId("search")}>Card {number} search term</label>
          <input id={fieldId("search")} value={card.searchTerm} maxLength={SEARCH_TERM_MAX} onChange={(event) => onChange({ searchTerm: event.target.value })} {...(errors.searchTerm ? { "aria-invalid": true, "aria-describedby": fieldId("searchTerm-error") } : { "aria-describedby": fieldId("link") })} />
          {errors.searchTerm ? <span className="admin-error" id={fieldId("searchTerm-error")}>{errors.searchTerm}</span> : <small id={fieldId("link")}>Links to {storePath(card.searchTerm)}</small>}
        </div>
        <p className="classics-admin__product"><span>Image from</span> <strong>{productLabel}</strong></p>
        {errors.product && <p className="admin-error">{errors.product}</p>}
        {card.warning && <p className="admin-warning">{WARNING_COPY[card.warning] || WARNING_COPY.unavailable}</p>}
      </div>
      <div className="featured-admin__slot-actions">
        <button type="button" className="admin-button" onClick={onChooseProduct} aria-pressed={choosing} aria-label={`Change product for card ${number}`}>{choosing ? "Choosing…" : "Change product"}</button>
        <button type="button" className="admin-button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move card ${number} up`}>Move up</button>
        <button type="button" className="admin-button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move card ${number} down`}>Move down</button>
        <button type="button" className="admin-link-button" onClick={onRemove} aria-label={`Remove card ${number}`}>Remove</button>
      </div>
    </li>
  );
};

export default ClassicCardEditor;
