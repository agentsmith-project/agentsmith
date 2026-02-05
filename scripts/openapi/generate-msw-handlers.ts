export async function generateHandlers({ input }: { input: string }) {
  return { handlersCount: input ? 1 : 0 };
}
