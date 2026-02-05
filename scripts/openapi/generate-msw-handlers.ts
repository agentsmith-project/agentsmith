export async function generateHandlers({ input }: { input: string }) {
  const _input = input;
  return {
    outputPath: 'src/mocks/handlers.generated.ts',
    content: 'http.get',
  };
}
