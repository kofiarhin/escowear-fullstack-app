import { humanize, statusTone } from "../../utils/admin";

// The status text is always shown; colour only reinforces the status group.
const StatusBadge = ({ status }) => <span className={`admin-badge is-${status} is-tone-${statusTone(status)}`}>{humanize(status)}</span>;

export default StatusBadge;
