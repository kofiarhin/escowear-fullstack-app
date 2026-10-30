import { Link } from "react-router-dom";
import { POLICY_VERSION, loadPolicySections, policiesStatus } from "../../policies/content";
import "./policies.styles.css";

// Policies stay unpublished until the owner approves them and the build guard passes
// (see policies/content.js for the build-time switch).
const Policies = () => {
  const status = policiesStatus();
  const sections = status === "hidden" ? [] : loadPolicySections();

  if (status === "hidden" || sections.length === 0) {
    return (
      <main className="policies container">
        <h1 className="title">Shop policies</h1>
        <p className="policies-lead">Our delivery, returns and privacy policies are being finalised. Questions about an order? Reply to any of our order emails.</p>
        <Link className="policies-link" to="/store">
          Continue shopping
        </Link>
      </main>
    );
  }

  return (
    <main className="policies container">
      {status === "draft" && (
        <div className="policies-draft" role="note">
          <strong>DRAFT — not yet published.</strong> This text is awaiting legal review and is not yet in force.
        </div>
      )}
      <h1 className="title">Shop policies</h1>
      <p className="policies-lead">How ordering, payment, delivery, cancellations, returns and your data work at EscoWear.</p>

      <nav className="policies-toc" aria-label="Policy sections">
        <ul>
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ul>
      </nav>

      {sections.map((section) => (
        <section key={section.id} id={section.id} className="policies-section" aria-labelledby={`${section.id}-title`}>
          <h2 id={`${section.id}-title`}>{section.title}</h2>
          {section.paragraphs?.map((text) => (
            <p key={text}>{text}</p>
          ))}
          {section.list && (
            <ol>
              {section.list.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ol>
          )}
        </section>
      ))}

      <p className="policies-version">Policy version {POLICY_VERSION}</p>
    </main>
  );
};

export default Policies;
