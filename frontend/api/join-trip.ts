import handler from '../server/join-trip.js';
import { postEndpoint } from '../server/http.js';

export default postEndpoint(handler);
