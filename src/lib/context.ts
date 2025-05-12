import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
	return {
		session: null,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
