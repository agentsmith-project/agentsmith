export async function generateFixtures({ input }: { input: string }) {
  const _input = input;
  return {
    outputPath: 'src/mocks/fixtures.generated.ts',
    content: 'required',
  };
}
