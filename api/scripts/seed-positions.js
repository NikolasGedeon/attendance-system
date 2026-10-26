/**
 * Seed / top-up the Position catalogue.
 *
 * Idempotent: uses prisma.position.upsert keyed on the unique `name`. Missing
 * positions are created; existing positions are matched and left untouched
 * (update: {}), so they are never renamed, reactivated, or duplicated. Safe to
 * run multiple times.
 *
 * Usage (from the api/ folder, with DATABASE_URL set in the environment or .env):
 *   node scripts/seed-positions.js
 *
 * Does not delete or modify existing data other than inserting missing rows.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// 45 unique job titles (deduplicated; "Cleaner (part-time 4h/day)" merged into "Cleaner").
const POSITIONS = [
  'Builder/Mason',
  'Maintenance Supervisor',
  'Maintenance',
  'General Labour',
  'Customer Care Manager',
  'Site Engineer',
  'Technician',
  'Plumber',
  'Chief Engineer Officer',
  'Head Quantity Surveyor',
  'Procurement Officer',
  'Accounting Supervisor',
  'Accountant',
  'Quantity Surveyor',
  'Senior Project Director',
  'Head of Interior Design',
  'PA to the CEO',
  'Senior Planner',
  'Senior Project Architect',
  'Senior Cost Control & Commercial Officer',
  'Logistics Manager',
  'General Foreman',
  'Junior Accountant',
  'Storageman',
  'Cleaner',
  'QA/QC Manager',
  'Junior Logistics Officer',
  'Foreman',
  'Crane Operator & Labour',
  'Chief Foreman',
  'Forklift Operator',
  'Worker',
  'Office Engineer',
  'Finishing Carpenter',
  'Carpenter',
  'Carpenter/Painter',
  'Assistant Technician',
  'Junior Site Engineer',
  'HSE Officer',
  'Project Manager',
  'Senior Architect',
  'Assistant Plumber',
  'Foreman - Gypsum Board',
  'Assistant Carpenter',
  'Painter',
];

async function main() {
  // De-dupe defensively in case the list is edited later.
  const names = [...new Set(POSITIONS.map((n) => n.trim()).filter(Boolean))];

  let created = 0;
  let existing = 0;

  for (const name of names) {
    // Track whether it existed only so we can print an accurate summary.
    const before = await prisma.position.findUnique({ where: { name } });

    // Idempotent write: create if missing, otherwise leave the row unchanged.
    await prisma.position.upsert({
      where: { name },
      update: {},
      create: { name, isActive: true },
    });

    if (before) {
      existing++;
    } else {
      created++;
      console.log(`+ created: ${name}`);
    }
  }

  console.log('----------------------------------------');
  console.log(`Positions in list : ${names.length}`);
  console.log(`Created           : ${created}`);
  console.log(`Already existed   : ${existing}`);
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
