export interface UserGuideGaBoundaryDocs {
  alertCenter: string;
  auditUsageReports: string;
  personalConnections: string;
}

interface BoundaryRule {
  doc: keyof UserGuideGaBoundaryDocs;
  label: string;
  required: readonly { pattern: RegExp; message: string }[];
  forbidden: readonly { pattern: RegExp; message: string }[];
}

const RULES: readonly BoundaryRule[] = [
  {
    doc: 'alertCenter',
    label: 'Alert Center user guide',
    required: [
      {
        pattern: /not a release orchestration[\s\S]{0,100}DevOps pipeline[\s\S]{0,100}budget-management[\s\S]{0,120}email-delivery[\s\S]{0,120}external notification/iu,
        message: 'must keep alerts out of release orchestration, DevOps, budget, email, and external notification platform scope',
      },
      {
        pattern: /in-app alert surface|in-app alert notifications/iu,
        message: 'must describe alerts as an in-app surface',
      },
      {
        pattern: /does not define[\s\S]{0,80}budget-management or enforcement platform/iu,
        message: 'must not claim budget management or enforcement',
      },
      {
        pattern: /does not\s+define retention, archival export, or automatic dismissal guarantees/iu,
        message: 'must not claim notification retention/export/auto-dismissal guarantees',
      },
    ],
    forbidden: [
      {
        pattern: /\b(?:email|webhook|chat|incident)[\w\s/-]{0,60}(?:notification|integration|delivery)[\w\s/-]{0,60}(?:is supported|are supported|is available|are available|will send|sends|delivers|configured by default)/iu,
        message: 'must not promise email, webhook, chat, incident, or external notification delivery',
      },
      {
        pattern: /\b(?:budget-management|budget management|budget enforcement|budget platform)[\w\s/-]{0,80}(?:is supported|is available|is provided|will enforce|enforces)/iu,
        message: 'must not promise budget-management or budget-enforcement behavior',
      },
      {
        pattern: /\b(?:auto-?dismiss(?:al)?|automatic dismissal)[\w\s/-]{0,60}(?:is supported|is available|is guaranteed|will run|runs automatically)/iu,
        message: 'must not promise automatic dismissal behavior',
      },
    ],
  },
  {
    doc: 'auditUsageReports',
    label: 'Audit & Usage user guide',
    required: [
      {
        pattern: /Retention, archival export, and immutable storage guarantees are deployment[\s\S]{0,120}backend policy concerns/iu,
        message: 'must scope retention/export/immutable storage to deployment and backend policy',
      },
      {
        pattern: /does not define a full-history export guarantee/iu,
        message: 'must not claim full-history export as a guide guarantee',
      },
      {
        pattern: /does not claim cryptographic immutability/iu,
        message: 'must not claim tamper-proof or cryptographic immutability guarantees',
      },
    ],
    forbidden: [
      {
        pattern: /\baudit logs are tamper-proof\b|\btamper-proof audit logs\b|\bcryptographically immutable audit\b/iu,
        message: 'must not promise tamper-proof audit logs',
      },
      {
        pattern: /\bfull-history export[\w\s/-]{0,60}(?:is supported|is available|is guaranteed|can be downloaded|can be exported)/iu,
        message: 'must not promise full-history export',
      },
      {
        pattern: /\b(?:retention|archival export|immutable storage)[\w\s/-]{0,80}(?:is guaranteed|are guaranteed|guarantee is provided|guarantees are provided)/iu,
        message: 'must not promise retention/export/immutable storage guarantees',
      },
    ],
  },
  {
    doc: 'personalConnections',
    label: 'Personal Connections user guide',
    required: [
      {
        pattern: /not project endpoint credentials/iu,
        message: 'must keep personal connections separate from project endpoint credentials',
      },
      {
        pattern: /not a provider registry and not a generic OAuth system/iu,
        message: 'must keep personal connections out of provider-registry and OAuth scope',
      },
      {
        pattern: /Do not use custom secret bundles to model OAuth authorization flows/iu,
        message: 'must forbid OAuth authorization-flow modeling through custom bundles',
      },
    ],
    forbidden: [
      {
        pattern: /\bprovider registry[\w\s/-]{0,80}(?:is supported|is available|is provided|for model providers|for SaaS providers)/iu,
        message: 'must not turn personal connections into a provider registry',
      },
      {
        pattern: /\bOAuth[\w\s/-]{0,80}(?:is supported|is available|flow is supported|authorization is supported|refresh is supported|success path)/iu,
        message: 'must not promise OAuth or credential-refresh success paths',
      },
      {
        pattern: /\bproject endpoint credentials[\w\s/-]{0,80}(?:are stored|can be stored|should be stored|belong here)/iu,
        message: 'must not route project endpoint credentials through personal connections',
      },
    ],
  },
] as const;

export function findUserGuideGaBoundaryViolations(docs: UserGuideGaBoundaryDocs): string[] {
  const failures: string[] = [];

  for (const rule of RULES) {
    const content = docs[rule.doc];
    for (const check of rule.required) {
      if (!check.pattern.test(content)) {
        failures.push(`${rule.label} ${check.message}`);
      }
    }
    for (const check of rule.forbidden) {
      if (check.pattern.test(content)) {
        failures.push(`${rule.label} ${check.message}`);
      }
    }
  }

  return failures;
}
