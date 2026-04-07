import { MongoClient } from 'mongodb';
import { resolveWorkspaceScopedCollection } from '../../packages/api-entry-node/src/workspace-tenant-collections.js';
import type { WorkspaceRecord } from '../../packages/api-entry-node/src/resource-models.js';

import { migrateLegacyType, migrateLegacyUpstreamProtocol } from './backfill-upstream-protocol-utils.js';
type StoredEndpointRecord = {
  _id?: string;
  id?: string;
  type?: string;
  provider_family?: string;
  upstream_protocol?: string;
  protocol?: string;
};

interface CliOptions {
  workspaceId?: string;
  apply: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--workspace') {
      options.workspaceId = argv[index + 1]?.trim() || undefined;
      index += 1;
      continue;
    }
    throw new Error(`unsupported_argument:${arg}`);
  }
  return options;
}

async function listWorkspaceIds(client: MongoClient, dbName: string, workspaceId?: string): Promise<string[]> {
  if (workspaceId) return [workspaceId];
  const items = await client.db(dbName).collection<WorkspaceRecord>('workspaces').find({}).toArray();
  return items
    .map((item) => item.id)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

async function main(): Promise<void> {
  const mongoUrl = process.env.MONGO_URL?.trim();
  const dbName = process.env.MONGO_DB_NAME?.trim() || 'mbos';
  if (!mongoUrl) {
    throw new Error('missing_env:MONGO_URL');
  }

  const options = parseArgs(process.argv.slice(2));
  const client = new MongoClient(mongoUrl);
  await client.connect();
  try {
    const workspaceIds = await listWorkspaceIds(client, dbName, options.workspaceId);
    if (workspaceIds.length === 0) {
      process.stdout.write('[endpoints] no workspaces found, nothing to backfill.\n');
      return;
    }

    let inspected = 0;
    let changed = 0;

    for (const workspaceId of workspaceIds) {
      const collectionName = resolveWorkspaceScopedCollection('endpoints', workspaceId);
      const collection = client.db(dbName).collection<StoredEndpointRecord>(collectionName);
      const docs = await collection.find({}).toArray();

      for (const doc of docs) {
        inspected += 1;
        const migrated = {
          upstream_protocol: migrateLegacyUpstreamProtocol(doc),
          type: migrateLegacyType(doc),
        };
        const needsBackfill =
          doc.upstream_protocol !== migrated.upstream_protocol
          || doc.type !== migrated.type
          || typeof doc.protocol !== 'undefined';
        if (!needsBackfill) continue;

        changed += 1;
        const endpointId = doc.id ?? doc._id ?? 'unknown_endpoint';
        process.stdout.write(
          `[endpoints] ${options.apply ? 'backfilling' : 'would_backfill'} workspace=${workspaceId} endpoint=${endpointId} upstream_protocol=${migrated.upstream_protocol} type=${migrated.type}\n`,
        );

        if (!options.apply) continue;

        await collection.updateOne(
          { _id: doc._id ?? endpointId },
          {
            $set: {
              upstream_protocol: migrated.upstream_protocol,
              type: migrated.type,
            },
            $unset: { protocol: '' },
          },
        );
      }
    }

    process.stdout.write(
      `[endpoints] inspected=${inspected} changed=${changed} mode=${options.apply ? 'apply' : 'dry-run'}\n`,
    );
  } finally {
    await client.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown_error';
  process.stderr.write(`[endpoints] upstream protocol backfill failed: ${message}\n`);
  process.exit(1);
});
