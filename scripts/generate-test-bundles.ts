import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { zipSync, type Zippable } from 'fflate';
import stableStringify from 'fast-json-stable-stringify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MediaFile {
  name: string;
  data: Buffer;
  dir?: string;
}

interface ViewFile {
  name: string;
  content: Record<string, unknown>;
}

interface ExtensionFile {
  name: string;
  data: string;
}

interface Extension {
  dir: string;
  files: ExtensionFile[];
}

interface ManifestOverrides {
  projectId?: string;
  locales?: string[];
  createdAt?: string;
  updatedAt?: string;
  custom?: Record<string, unknown>;
}

interface BuildBundleOptions {
  businessData: Record<string, unknown>;
  manifestOverrides?: ManifestOverrides;
  mediaFiles?: MediaFile[];
  viewFiles?: ViewFile[];
  extensions?: Extension[];
  includeIntegrity?: boolean;
  extraReferences?: string[];
}

interface ZipEntry {
  name: string;
  buffer: Buffer;
}

interface IntegrityFilesMap {
  [path: string]: string;
}

interface Manifest {
  fileFormat: string;
  formatVersion: string;
  schemaVersion: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  generator: { name: string; version: string };
  locales: string[];
  integrity?: {
    algorithm: string;
    hash: string;
    files: IntegrityFilesMap;
  };
  custom: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');
const FIXTURES_DIR = path.join(ROOT, 'test-fixtures');
const INVALID_DIR = path.join(FIXTURES_DIR, 'invalid');

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const BLUE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQI12NgYPj/n4EBCBg5cuQ/JgAJEgP+HahS2wAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64ToBuffer(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}

function normalizeNFC(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(normalizeNFC);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalizeNFC(v)])
    );
  }
  return value;
}

function canonicalSerialize(obj: unknown): string {
  return stableStringify(normalizeNFC(obj));
}

function sha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function collectMediaRefs(value: unknown, refs: Set<string>): void {
  if (typeof value === 'string') {
    const m = /^media:\/\/([a-zA-Z0-9_\-.\/]+)$/.exec(value);
    if (m) refs.add(m[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) collectMediaRefs(item, refs);
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectMediaRefs(v, refs);
    }
  }
}

// ---------------------------------------------------------------------------
// Bundle Builder
// ---------------------------------------------------------------------------

function buildBundle({
  businessData,
  manifestOverrides = {},
  mediaFiles = [],
  viewFiles = [],
  extensions = [],
  includeIntegrity = true,
  extraReferences = []
}: BuildBundleOptions): Buffer {
  // 1. NFC-normalise all JSON objects
  const normalizedBusiness = normalizeNFC(businessData);
  const normalizedViews = viewFiles.map(v => ({
    name: v.name,
    content: normalizeNFC(v.content) as Record<string, unknown>
  }));

  // 2. Canonical serialisation
  const businessJson = canonicalSerialize(normalizedBusiness);
  const viewJsonMap: Record<string, string> = {};
  for (const v of normalizedViews) {
    viewJsonMap[v.name] = canonicalSerialize(v.content);
  }

  // 3. Media whitelist construction (in-memory traversal)
  const refs = new Set<string>();
  collectMediaRefs(normalizedBusiness, refs);
  for (const v of normalizedViews) {
    collectMediaRefs(v.content, refs);
  }
  for (const ref of extraReferences) refs.add(ref);

  for (const ext of extensions) {
    for (const file of ext.files) {
      if (file.name === 'media-references.json') {
        const mediaRefs: unknown = JSON.parse(file.data);
        if (Array.isArray(mediaRefs)) {
          for (const r of mediaRefs) refs.add(r);
        }
      }
    }
  }

  const zipFiles: ZipEntry[] = [];

  // 4. business.json
  zipFiles.push({
    name: 'business.json',
    buffer: Buffer.from(businessJson, 'utf-8')
  });

  // 5. View files
  for (const [vname, vcontent] of Object.entries(viewJsonMap)) {
    zipFiles.push({
      name: `views/${vname}`,
      buffer: Buffer.from(vcontent, 'utf-8')
    });
  }

  // 6. Media files (only those in whitelist)
  for (const mf of mediaFiles) {
    const p = mf.dir ? `${mf.dir}/${mf.name}` : mf.name;
    if (refs.has(p)) {
      zipFiles.push({
        name: `media/${p}`,
        buffer: mf.data
      });
    }
  }

  // 7. Extensions
  for (const ext of extensions) {
    for (const file of ext.files) {
      zipFiles.push({
        name: `extensions/${ext.dir}/${file.name}`,
        buffer: Buffer.from(file.data, 'utf-8')
      });
    }
  }

  // 8. Per-file hashing (except manifest.json)
  const integrityFiles: IntegrityFilesMap = {};
  for (const f of zipFiles) {
    integrityFiles[f.name] = sha256(f.buffer);
  }

  // 9. Build manifest.json
  const manifest: Manifest = normalizeNFC({
    fileFormat: 'open-business-bundle',
    formatVersion: '0.1.0',
    schemaVersion: '0.1.0',
    projectId: manifestOverrides.projectId || 'urn:obb:project:01J3Z8VTYKABCDEF01234567AB',
    createdAt: manifestOverrides.createdAt || '2026-03-15T08:00:00Z',
    updatedAt: manifestOverrides.updatedAt || '2026-06-14T09:00:00Z',
    generator: { name: 'obb-test-generator', version: '1.0.0' },
    locales: manifestOverrides.locales || ['en'],
    integrity: includeIntegrity ? {
      algorithm: 'sha256',
      hash: '',
      files: integrityFiles
    } : undefined,
    custom: manifestOverrides.custom || {}
  }) as Manifest;

  // 10. Manifest self-hash
  if (includeIntegrity && manifest.integrity) {
    const manifestJson = canonicalSerialize(manifest);
    const selfHash = sha256(manifestJson);
    manifest.integrity.hash = selfHash;
  }

  const manifestJsonFinal = canonicalSerialize(manifest);

  zipFiles.unshift({
    name: 'manifest.json',
    buffer: Buffer.from(manifestJsonFinal, 'utf-8')
  });

  // 11. Create ZIP archive
  return buildZip(zipFiles);
}

function buildZip(entries: ZipEntry[]): Buffer {
  const zip: Zippable = {};

  for (const entry of entries) {
    zip[entry.name] = [new Uint8Array(entry.buffer), { level: 6 }];
  }

  const zipped = zipSync(zip, { level: 6 });
  return Buffer.from(zipped);
}

// ---------------------------------------------------------------------------
// Fixture Data
// ---------------------------------------------------------------------------

function createMinimalBundle(): Buffer {
  return buildBundle({
    businessData: {
      global: {
        currency: 'USD',
        baseLanguage: 'en',
        timezone: 'America/New_York',
        measurementSystem: 'metric'
      },
      identity: {
        companyName: 'Acme Corp',
        tagline: 'Simple business solutions',
        logo: 'media://branding/logo.png',
        website: 'https://acme.example.com',
        socialProfiles: {
          linkedin: 'https://linkedin.com/company/acme',
          twitter: '@acme'
        }
      }
    },
    mediaFiles: [
      { dir: 'branding', name: 'logo.png', data: base64ToBuffer(TINY_PNG_BASE64) }
    ],
    manifestOverrides: {
      projectId: 'urn:obb:project:01ARZ3NDEKTSV4RRFFQ69G5FAV',
      locales: ['en'],
      createdAt: '2026-01-10T12:00:00Z',
      updatedAt: '2026-01-10T12:00:00Z'
    }
  });
}

function createFullFeaturedBundle(): Buffer {
  return buildBundle({
    businessData: {
      global: {
        currency: 'EUR',
        baseLanguage: 'en',
        timezone: 'Europe/Berlin',
        measurementSystem: 'metric'
      },
      identity: {
        companyName: 'SaaSOptimize',
        tagline: 'AI-Driven Operational Cloud Cost Infrastructure Metrics Extraction Layer',
        logo: 'media://branding/logo.png',
        website: 'https://saasoptimize.com',
        socialProfiles: {
          linkedin: 'https://linkedin.com/company/saasoptimize',
          twitter: '@saasoptimize'
        }
      },
      legalProfile: {
        legalName: 'SaaSOptimize Technologies Inc.',
        entityType: 'C-Corporation',
        jurisdiction: 'Delaware, USA',
        dateFounded: '2026-01-10',
        taxId: 'XX-XXXXXXX',
        address: {
          street: '123 Innovation Drive',
          city: 'Wilmington',
          postalCode: '19801',
          country: 'US'
        }
      },
      executiveSummary: {
        mission: 'Democratize cloud cost optimization through AI',
        vision: 'A world where every business optimizes cloud spend automatically',
        problem: 'Cloud costs are opaque and hard to optimize manually',
        solution: 'AI-driven real-time cost analysis and optimization',
        elevatorPitch: 'We help companies save 40% on cloud costs automatically',
        keyHighlights: [
          'AI-powered analytics',
          'Real-time cost monitoring',
          'Automated optimization'
        ]
      },
      valueProposition: [
        {
          id: 'cost-savings',
          title: '40% Cost Reduction',
          description: 'Automatically identify and eliminate wasteful cloud spending',
          icon: 'media://branding/icon-savings.png',
          metrics: { avgSavings: 40, timeToValue: '2 weeks' }
        },
        {
          id: 'real-time',
          title: 'Real-Time Visibility',
          description: 'Dashboard with live cost metrics across all cloud providers',
          icon: 'media://branding/icon-dashboard.png',
          metrics: { dataFreshness: '1s', supportedProviders: 3 }
        }
      ],
      managementTeam: {
        founders: [
          {
            id: 'founder-1', name: 'Alice Schmidt', role: 'CEO',
            bio: 'Former AWS cost optimization lead with 15 years experience',
            imageSrc: 'media://team/alice.jpg'
          },
          {
            id: 'founder-2', name: 'Bob Chen', role: 'CTO',
            bio: 'Distributed systems architect, ex-Google SRE',
            imageSrc: 'media://team/bob.jpg'
          }
        ],
        advisors: [
          {
            id: 'adv-1', name: 'Carol Williams', role: 'Financial Advisor',
            bio: 'Former CFO of CloudScale Inc.'
          }
        ],
        boardMembers: [
          {
            id: 'board-1', name: 'Dr. David Park', role: 'Board Chair',
            bio: 'Professor of Computer Science, MIT'
          }
        ]
      },
      productsServices: [
        {
          name: 'CloudCost Optimizer',
          description: 'AI-powered cloud cost optimization platform',
          pricingModel: 'subscription',
          stage: 'growth',
          screenshots: ['media://products/dashboard.png', 'media://products/analytics.png'],
          features: ['Real-time cost monitoring', 'AI-driven recommendations', 'Multi-cloud support', 'Automated rightsizing']
        }
      ],
      marketAnalysis: {
        targetMarket: 'Mid-to-large enterprises with >$1M annual cloud spend',
        competitors: [
          { name: 'CloudHealth', strengths: ['Brand recognition', 'Large customer base'], weaknesses: ['Legacy architecture', 'Slow innovation'] }
        ],
        swot: {
          strengths: ['Proprietary AI models', 'First-mover advantage'],
          weaknesses: ['Small sales team', 'Limited brand awareness'],
          opportunities: ['Growing cloud market', 'Regulatory compliance needs'],
          threats: ['AWS native tools', 'Open source alternatives']
        },
        marketSize: { tam: 30000000000, sam: 5000000000, som: 500000000 }
      },
      marketingStrategy: {
        channels: ['Content marketing', 'Cloud conferences', 'Partner referrals'],
        contentPlan: 'Weekly blog posts, monthly webinars, quarterly reports',
        cacEstimate: 15000
      },
      operations: {
        teamSize: 45,
        techStack: ['Python', 'Go', 'React', 'Kubernetes', 'PostgreSQL'],
        ipPatents: ['US20260000000A1 - AI Cloud Optimization'],
        compliance: ['SOC 2 Type II', 'GDPR', 'ISO 27001']
      },
      roadmap: {
        milestones: [
          { date: '2026-03-01', title: 'MVP Launch', status: 'completed' },
          { date: '2026-06-01', title: 'Multi-Cloud Support', status: 'in-progress' },
          { date: '2026-09-01', title: 'ML-Powered Predictions', status: 'planned' }
        ]
      },
      financialStatements: {
        incomeStatement: { revenue: 2500000, cogs: 800000, operatingExpenses: 1200000, netIncome: 500000 },
        balanceSheet: { totalAssets: 5000000, totalLiabilities: 1500000, equity: 3500000 },
        cashFlow: { operating: 600000, investing: -200000, financing: 100000 },
        forecasts: { nextYearRevenue: 5000000, nextYearNetIncome: 1500000 }
      },
      fundingRequirements: {
        amountNeeded: 5000000,
        useOfFunds: [
          { category: 'Engineering', amount: 2500000 },
          { category: 'Sales & Marketing', amount: 1500000 },
          { category: 'Operations', amount: 1000000 }
        ],
        offeringStructure: 'Series A - Preferred Stock'
      },
      riskAnalysis: {
        risks: [
          { type: 'Market competition', likelihood: 4, impact: 3, mitigation: 'Continuous innovation and IP protection' },
          { type: 'Cloud provider policy changes', likelihood: 3, impact: 4, mitigation: 'Multi-cloud strategy and vendor independence' }
        ]
      },
      appendices: [
        { title: 'Market Research Report', url: 'media://documents/market-research.pdf' },
        { title: 'Technical Whitepaper', url: 'media://documents/whitepaper.pdf' }
      ]
    },
    mediaFiles: [
      { dir: 'branding', name: 'logo.png', data: base64ToBuffer(TINY_PNG_BASE64) },
      { dir: 'branding', name: 'icon-savings.png', data: base64ToBuffer(BLUE_PNG_BASE64) },
      { dir: 'branding', name: 'icon-dashboard.png', data: base64ToBuffer(BLUE_PNG_BASE64) },
      { dir: 'team', name: 'alice.jpg', data: base64ToBuffer(TINY_PNG_BASE64) },
      { dir: 'team', name: 'bob.jpg', data: base64ToBuffer(TINY_PNG_BASE64) },
      { dir: 'products', name: 'dashboard.png', data: base64ToBuffer(BLUE_PNG_BASE64) },
      { dir: 'products', name: 'analytics.png', data: base64ToBuffer(BLUE_PNG_BASE64) },
      { dir: 'documents', name: 'market-research.pdf', data: base64ToBuffer(TINY_PNG_BASE64) },
      { dir: 'documents', name: 'whitepaper.pdf', data: base64ToBuffer(TINY_PNG_BASE64) }
    ],
    viewFiles: [
      {
        name: 'business-plan.json',
        content: {
          viewType: 'business-plan',
          version: '1.0',
          settings: { paperSize: 'a4', styleConfiguration: { primaryColor: '#16a34a', mode: 'light' } },
          contentOrder: ['identity', 'executiveSummary', 'legalProfile', 'valueProposition', 'marketAnalysis', 'productsServices', 'managementTeam', 'financialStatements', 'fundingRequirements', 'riskAnalysis'],
          sections: { identity: { layout: 'centered-hero' }, executiveSummary: { layout: 'two-column' } },
          references: { dataPaths: ['identity.logo', 'managementTeam.founders[*].imageSrc', 'productsServices[*].screenshots'] }
        }
      },
      {
        name: 'pitch-deck.json',
        content: {
          viewType: 'pitch-deck',
          version: '1.0',
          settings: { paperSize: '16:9', styleConfiguration: { primaryColor: '#2563eb', mode: 'dark' } },
          contentOrder: ['identity', 'problem', 'solution', 'marketAnalysis', 'productsServices', 'managementTeam', 'financialStatements', 'fundingRequirements'],
          references: { dataPaths: ['identity.logo', 'productsServices[*].screenshots[*]'] }
        }
      }
    ],
    manifestOverrides: {
      projectId: 'urn:obb:project:01ARZ3NDEKTSV4RRFFQ69G5FBV',
      locales: ['en']
    }
  });
}

function createMissingMediaBundle(): Buffer {
  return buildBundle({
    businessData: {
      global: {
        currency: 'USD', baseLanguage: 'en', timezone: 'America/Chicago', measurementSystem: 'metric'
      },
      identity: {
        companyName: 'Missing Media Inc.',
        tagline: 'Where did the logo go?',
        logo: 'media://branding/nonexistent.png',
        website: 'https://missing.example.com'
      }
    },
    mediaFiles: [],
    manifestOverrides: {
      projectId: 'urn:obb:project:01ARZ3NDEKTSV4RRFFQ69G5FCM',
      locales: ['en'],
      createdAt: '2026-05-01T10:00:00Z',
      updatedAt: '2026-05-01T10:00:00Z'
    },
    extraReferences: ['branding/nonexistent.png']
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.mkdirSync(INVALID_DIR, { recursive: true });

  console.log('Generating test fixtures...');

  const minimal = createMinimalBundle();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'minimal.obbiz'), minimal);
  console.log(`  Created minimal.obbiz -> ${minimal.length} bytes`);

  const full = createFullFeaturedBundle();
  fs.writeFileSync(path.join(FIXTURES_DIR, 'full-featured.obbiz'), full);
  console.log(`  Created full-featured.obbiz -> ${full.length} bytes`);

  const missing = createMissingMediaBundle();
  fs.writeFileSync(path.join(INVALID_DIR, 'missing-media.obbiz'), missing);
  console.log(`  Created invalid/missing-media.obbiz -> ${missing.length} bytes`);

  console.log('\nDone.');
}

main();
