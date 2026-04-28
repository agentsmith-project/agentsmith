import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type PackageJson = {
  scripts?: Record<string, string>;
};

const failures: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    failures.push(message);
  }
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(relativePath), 'utf8')) as T;
}

function retiredPath(...parts: readonly string[]): string {
  return parts.join('/');
}

function retiredCommand(...parts: readonly string[]): string {
  return parts.join(':');
}

function retiredFile(...parts: readonly string[]): string {
  return parts.join('-');
}

function main(): void {
  const packageJson = readJson<PackageJson>('package.json');
  const packageScripts = packageJson.scripts ?? {};
  const implementationDir = retiredPath('scripts', ['oss', 'export'].join('-'));
  const implementationPath = `${implementationDir}/`;
  const retiredPackageScriptNames = [
    retiredCommand('oss', 'export'),
    retiredCommand('oss', 'verify'),
    retiredCommand('oss', 'publish'),
  ];
  const retiredImplementationNames = [
    retiredFile('build', 'oss', 'tree'),
    retiredFile('publish', 'oss'),
    retiredFile('verify', 'oss', 'tree'),
  ];

  assert(!existsSync(resolve(implementationDir)), 'retired public-code export implementation directory must not exist.');

  for (const scriptName of retiredPackageScriptNames) {
    assert(!(scriptName in packageScripts), `package.json must not expose retired script ${scriptName}.`);
  }

  for (const [scriptName, scriptCommand] of Object.entries(packageScripts)) {
    assert(
      !scriptCommand.includes(implementationPath),
      `package.json script ${scriptName} must not point at retired public-code export implementation path.`,
    );
    for (const implementationName of retiredImplementationNames) {
      assert(
        !scriptCommand.includes(implementationName),
        `package.json script ${scriptName} must not point at retired public-code export implementation ${implementationName}.`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

main();
