export async function generateTypes({ input }: { input: string }) {
  const _input = input;
  return {
    outputPath: 'src/lib/api/types.generated.ts',
    content: 'export interface Mock {}',
  };
}
