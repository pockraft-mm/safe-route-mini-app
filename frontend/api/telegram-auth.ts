import handler from '../server/telegram-auth.js';
import { postEndpoint } from '../server/http.js';

export default postEndpoint(handler);
