/**
 * ci-validate.ts
 *
 * CI validation script for OBB schemas and test fixtures.
 * Run from repository root: node scripts/ci-validate.ts  (via tsx)
 *                     or:  npm run ci-validate  (from scripts/)
 */

import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';

interface FixtureEntry {
  manifest: string;
  business: string;
}

const ROOT = path.resolve(__dirname, '..');
const VALIDATE_DIR = '/tmp/obb-validate';

function readJSON<T = unknown>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

/**
 * Load a schema, stripping the $schema field to avoid meta-schema
 * resolution issues in environments without draft 2020-12 support.
 */
function loadSchema(p: string): Record<string, unknown> {
  const s = readJSON<Record<string, unknown>>(p);
  delete s.$schema;
  return s;
}

function isErrorArray(errors: ErrorObject[] | null | undefined): errors is ErrorObject[] {
  return errors !== null && errors !== undefined;
}

// Load schemas
const manifestSchema = loadSchema(path.join(ROOT, 'definitions/v0.1.0/manifest.schema.json'));
const businessSchema = loadSchema(path.join(ROOT, 'definitions/v0.1.0/business.schema.json'));
const viewSchema = loadSchema(path.join(ROOT, 'definitions/v0.1.0/view.schema.json'));

// Compile schemas with Ajv
const ajv = new Ajv({ strict: false, allErrors: true, validateSchema: false });
addFormats(ajv);

ajv.addSchema(manifestSchema, 'manifest');
ajv.addSchema(businessSchema, 'business');
ajv.addSchema(viewSchema, 'view');

console.log('All schemas compiled successfully');

// Validate test data fixtures
const fixtures: Record<string, FixtureEntry> = {
  minimal: {
    manifest: path.join(VALIDATE_DIR, 'minimal/manifest.json'),
    business: path.join(VALIDATE_DIR, 'minimal/business.json')
  },
  'full-featured': {
    manifest: path.join(VALIDATE_DIR, 'full-featured/manifest.json'),
    business: path.join(VALIDATE_DIR, 'full-featured/business.json')
  },
  'invalid-missing-media': {
    manifest: path.join(VALIDATE_DIR, 'invalid-missing-media/manifest.json'),
    business: path.join(VALIDATE_DIR, 'invalid-missing-media/business.json')
  }
};

let allPassed = true;

for (const [name, files] of Object.entries(fixtures)) {
  const mData = readJSON(files.manifest);
  const bData = readJSON(files.business);

  const mValid = ajv.validate('manifest', mData);
  if (!mValid) {
    console.log(`FAIL: ${name}/manifest.json`);
    if (isErrorArray(ajv.errors)) {
      console.log(JSON.stringify(ajv.errors, null, 2));
    }
    allPassed = false;
  } else {
    console.log(`PASS: ${name}/manifest.json`);
  }

  const bValid = ajv.validate('business', bData);
  if (!bValid) {
    console.log(`FAIL: ${name}/business.json`);
    if (isErrorArray(ajv.errors)) {
      console.log(JSON.stringify(ajv.errors, null, 2));
    }
    allPassed = false;
  } else {
    console.log(`PASS: ${name}/business.json`);
  }
}

// Validate view files
const viewDirs = [path.join(VALIDATE_DIR, 'full-featured/views')];

for (const dir of viewDirs) {
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const vf = path.join(dir, file);
      const vData = readJSON(vf);
      const vValid = ajv.validate('view', vData);
      if (!vValid) {
        console.log(`FAIL: ${vf}`);
        if (isErrorArray(ajv.errors)) {
          console.log(JSON.stringify(ajv.errors, null, 2));
        }
        allPassed = false;
      } else {
        console.log(`PASS: ${vf}`);
      }
    }
  }
}

console.log(`\n=== ${allPassed ? 'ALL VALIDATIONS PASSED' : 'SOME VALIDATIONS FAILED'} ===`);
process.exit(allPassed ? 0 : 1);
