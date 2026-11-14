import { setupServer } from 'msw/node';

/** MSW server for component tests; individual tests register handlers with `server.use(...)`. */
export const server = setupServer();
