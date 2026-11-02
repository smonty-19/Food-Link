/** Result returned by Server Actions used with useActionState. */
export type FormState = { error?: string; success?: string } | undefined;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
